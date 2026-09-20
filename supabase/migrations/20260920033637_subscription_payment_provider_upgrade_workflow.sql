begin;

alter table public.subscription_payments
 add column if not exists payment_type text not null default 'subscription',
 add column if not exists payment_method_id uuid,
 add column if not exists payment_method_reference text,
 add column if not exists payment_method_snapshot jsonb,
 add column if not exists provider_order_id text,
 add column if not exists provider_payment_id text,
 add column if not exists provider_signature text,
 add column if not exists provider_verification_status text;
alter table public.subscription_payments drop constraint if exists subscription_payments_payment_type_check;
alter table public.subscription_payments add constraint subscription_payments_payment_type_check check(payment_type in('subscription','renewal','plan_upgrade'));
alter table public.subscription_payments drop constraint if exists subscription_payments_provider_verification_status_check;
alter table public.subscription_payments add constraint subscription_payments_provider_verification_status_check check(provider_verification_status is null or provider_verification_status in('not_applicable','pending','verified','failed'));

create table if not exists public.subscription_payment_methods(
 id uuid primary key default gen_random_uuid(),
 provider text not null default 'manual' check(provider in('manual','razorpay')),
 method_type text not null default 'upi' check(method_type in('upi','bank','razorpay')),
 display_name text not null, upi_id text, active boolean not null default true,
 is_default boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((method_type='upi' and upi_id is not null) or method_type<>'upi'));
alter table public.subscription_payment_methods enable row level security;
revoke all on public.subscription_payment_methods from anon,authenticated;
grant select on public.subscription_payment_methods to authenticated;
drop policy if exists subscription_payment_methods_select on public.subscription_payment_methods;
create policy subscription_payment_methods_select on public.subscription_payment_methods for select to authenticated using((select is_super_admin()) or ((select is_active_canteen_admin()) and active));
create unique index if not exists subscription_payment_methods_one_default on public.subscription_payment_methods(is_default) where is_default;
create index if not exists subscription_payment_methods_active_idx on public.subscription_payment_methods(active,is_default);
alter table public.subscription_payments add constraint subscription_payments_payment_method_id_fkey foreign key(payment_method_id) references public.subscription_payment_methods(id) on delete set null;
insert into public.subscription_payment_methods(provider,method_type,display_name,upi_id,is_default)
select 'manual','upi',coalesce(s.payment_display_name,'GoCanteen'),s.upi_id,true from public.subscription_payment_settings s
where s.id=true and s.manual_payment_enabled and not exists(select 1 from public.subscription_payment_methods);

create or replace function public.can_canteen_operate(p_canteen_id uuid default null) returns boolean language sql stable security definer set search_path='' as $$
select case when auth.uid() is null then false
when exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin' and p.admin_role='super_admin' and p.status='active') then true
else exists(select 1 from public.profiles p join public.canteens c on c.id=p.canteen_id left join public.canteen_subscriptions s on s.canteen_id=p.canteen_id
where p.id=(select auth.uid()) and p.status='active' and p.canteen_id=coalesce(p_canteen_id,p.canteen_id) and not c.archived
and(s.id is null or case s.status when 'trial' then s.trial_end>now() when 'active' then s.subscription_end>now()
when 'payment_pending' then(s.trial_end>now() or s.subscription_end>now()) else false end)) end $$;

create or replace function public.sync_subscription_statuses(p_canteen_id uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare s public.canteen_subscriptions; pid uuid; p public.subscription_plans; amt numeric(12,2);
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if not(public.is_super_admin() or (p_canteen_id is not null and public.current_canteen_id()=p_canteen_id)) then raise exception 'Not authorized'; end if;
 for s in select * from public.canteen_subscriptions where(p_canteen_id is null or canteen_id=p_canteen_id) and((status='trial' and trial_end<=now()) or(status='active' and subscription_end<=now())) for update loop
  if s.plan_selection_mode='auto_range' then pid:=public.resolve_member_range_plan(s.canteen_id); else pid:=s.plan_id; end if;
  select * into p from public.subscription_plans where id=coalesce(pid,s.plan_id);
  amt:=case when s.billing_cycle='annual' then p.annual_price else p.monthly_price end;
  update public.canteen_subscriptions set plan_id=coalesce(pid,s.plan_id),amount=coalesce(amt,amount),
   status=case when s.status='trial' then 'suspended' else 'expired' end,payment_status='pending',updated_at=now() where id=s.id;
 end loop;
end $$;

create or replace function public.get_subscription_upgrade_quote(p_canteen_id uuid,p_new_plan_id uuid default null) returns jsonb language plpgsql security definer stable set search_path='' as $$
declare s public.canteen_subscriptions; oldp public.subscription_plans; newp public.subscription_plans; nid uuid; members int; months int; diff numeric(12,2); total numeric(12,2);
begin
 if auth.uid() is null or not(public.is_super_admin() or public.current_canteen_id()=p_canteen_id) then raise exception 'Not authorized'; end if;
 select * into s from public.canteen_subscriptions where canteen_id=p_canteen_id;
 if not found then raise exception 'Subscription not found'; end if;
 if s.status<>'active' or s.billing_cycle<>'annual' then return jsonb_build_object('required',false); end if;
 select * into oldp from public.subscription_plans where id=s.plan_id;
 members:=(select count(*) from public.profiles where canteen_id=p_canteen_id and role='employee' and status='active');
 nid:=coalesce(p_new_plan_id,case when s.plan_selection_mode='auto_range' then public.resolve_member_range_plan(p_canteen_id) end);
 if nid is null or nid=oldp.id then return jsonb_build_object('required',false,'active_members',members); end if;
 select * into newp from public.subscription_plans where id=nid and active;
 if not found then raise exception 'New plan not found'; end if;
 select count(*) into months from generate_series(1,60) g(n) where now()+g.n*interval '1 month'<=s.subscription_end;
 diff:=round(newp.monthly_price-oldp.monthly_price,2); total:=greatest(0,round(diff*greatest(months,0),2));
 return jsonb_build_object('required',total>0,'active_members',members,'current_plan_id',oldp.id,'current_plan_name',oldp.name,
 'current_monthly_equivalent',oldp.monthly_price,'new_plan_id',newp.id,'new_plan_name',newp.name,'new_monthly_equivalent',newp.monthly_price,
 'monthly_difference',diff,'remaining_full_months',greatest(months,0),'additional_amount',total,'currency',newp.currency,
 'original_subscription_start',s.subscription_start,'original_subscription_end',s.subscription_end);
end $$;

create or replace function public.canteen_create_subscription_payment(p_subscription_id uuid,p_billing_cycle text,p_payment_date date,p_reference text,p_note text default null,p_payment_method_id uuid default null)
returns public.subscription_payments language plpgsql security definer set search_path='' as $$
declare s public.canteen_subscriptions; p public.subscription_plans; m public.subscription_payment_methods; outp public.subscription_payments; pid uuid; expected numeric(12,2);
begin
 if auth.uid() is null or not public.is_active_canteen_admin() then raise exception 'Canteen Admin authorization required'; end if;
 select * into s from public.canteen_subscriptions where id=p_subscription_id and canteen_id=public.current_canteen_id() for update;
 if not found then raise exception 'Subscription not found'; end if;
 if s.status not in('trial','payment_pending','expired','suspended') then raise exception 'Payment is not currently required for this subscription'; end if;
 if p_billing_cycle not in('monthly','annual') or nullif(trim(coalesce(p_reference,'')),'') is null or p_payment_date is null then raise exception 'Payment details are required'; end if;
 if exists(select 1 from public.subscription_payments where subscription_id=s.id and payment_status='pending' and payment_type<>'plan_upgrade') then raise exception 'A payment is already pending review for this subscription'; end if;
 pid:=case when s.plan_selection_mode='auto_range' then public.resolve_member_range_plan(s.canteen_id) else s.plan_id end;
 select * into p from public.subscription_plans where id=pid and active;
 if not found then raise exception 'Active subscription plan not found'; end if;
 expected:=case when p_billing_cycle='annual' then p.annual_price else p.monthly_price end;
 select * into m from public.subscription_payment_methods where id=coalesce(p_payment_method_id,(select id from public.subscription_payment_methods where active and is_default limit 1)) and active;
 if not found then raise exception 'No active payment method is configured'; end if;
 insert into public.subscription_payments(canteen_id,subscription_id,plan_id,amount,currency,payment_date,payment_status,transaction_reference,payment_provider,payment_note,billing_cycle,payment_type,payment_method_id,payment_method_reference,payment_method_snapshot)
 values(s.canteen_id,s.id,p.id,expected,p.currency,p_payment_date::timestamptz,'pending',trim(p_reference),m.provider,nullif(trim(coalesce(p_note,'')),''),p_billing_cycle,case when s.status='active' then 'renewal' else 'subscription' end,m.id,coalesce(m.upi_id,m.display_name),jsonb_build_object('id',m.id,'provider',m.provider,'method_type',m.method_type,'display_name',m.display_name,'upi_id',m.upi_id)) returning * into outp;
 update public.canteen_subscriptions set payment_status='pending',updated_at=now() where id=s.id; return outp;
end $$;

create or replace function public.canteen_submit_plan_upgrade_payment(p_new_plan_id uuid,p_payment_date date,p_reference text,p_note text default null,p_payment_method_id uuid default null)
returns public.subscription_payments language plpgsql security definer set search_path='' as $$
declare cid uuid:=public.current_canteen_id(); s public.canteen_subscriptions; q jsonb; p public.subscription_plans; m public.subscription_payment_methods; outp public.subscription_payments;
begin
 if auth.uid() is null or not public.is_active_canteen_admin() then raise exception 'Canteen Admin authorization required'; end if;
 q:=public.get_subscription_upgrade_quote(cid,p_new_plan_id);
 if coalesce((q->>'required')::boolean,false)=false then raise exception 'No plan upgrade payment is required'; end if;
 if exists(select 1 from public.subscription_payments p join public.canteen_subscriptions s2 on s2.id=p.subscription_id where s2.canteen_id=cid and p.payment_status='pending' and p.payment_type='plan_upgrade') then raise exception 'A plan upgrade payment is already pending review'; end if;
 select * into s from public.canteen_subscriptions where canteen_id=cid for update;
 select * into p from public.subscription_plans where id=p_new_plan_id and active;
 select * into m from public.subscription_payment_methods where id=coalesce(p_payment_method_id,(select id from public.subscription_payment_methods where active and is_default limit 1)) and active;
 if not found then raise exception 'No active payment method is configured'; end if;
 insert into public.subscription_payments(canteen_id,subscription_id,plan_id,amount,currency,payment_date,payment_status,transaction_reference,payment_provider,payment_note,billing_cycle,payment_type,billing_period_start,billing_period_end,payment_method_id,payment_method_reference,payment_method_snapshot)
 values(cid,s.id,p.id,(q->>'additional_amount')::numeric,p.currency,p_payment_date::timestamptz,'pending',trim(p_reference),m.provider,nullif(trim(coalesce(p_note,'')),''),'annual','plan_upgrade',s.subscription_start,s.subscription_end,m.id,coalesce(m.upi_id,m.display_name),jsonb_build_object('id',m.id,'provider',m.provider,'method_type',m.method_type,'display_name',m.display_name,'upi_id',m.upi_id)) returning * into outp;
 return outp;
end $$;

create or replace function public.super_admin_review_subscription_payment(p_payment_id uuid,p_status text,p_billing_cycle text default null)
returns public.subscription_payments language plpgsql security definer set search_path='' as $$
declare pay public.subscription_payments; s public.canteen_subscriptions; p public.subscription_plans; q jsonb; cycle text; start_at timestamptz; end_at timestamptz; expected numeric(12,2);
begin
 if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
 select * into pay from public.subscription_payments where id=p_payment_id for update;
 if not found or pay.payment_status<>'pending' then raise exception 'Only pending payments can be reviewed'; end if;
 select * into s from public.canteen_subscriptions where id=pay.subscription_id for update;
 if p_status='failed' then
  update public.subscription_payments set payment_status='failed',updated_at=now() where id=pay.id returning * into pay;
  update public.canteen_subscriptions set status=case when s.status in('suspended','expired') then s.status else s.status end,payment_status='failed',updated_at=now() where id=s.id;
  return pay;
 end if;
 if p_status<>'paid' then raise exception 'Review status must be paid or failed'; end if;
 if pay.payment_type='plan_upgrade' then
  select * into p from public.subscription_plans where id=pay.plan_id and active;
  q:=public.get_subscription_upgrade_quote(s.canteen_id,p.id); expected:=coalesce((q->>'additional_amount')::numeric,0);
  if s.status<>'active' or s.billing_cycle<>'annual' or expected<=0 or round(pay.amount,2)<>round(expected,2) then raise exception 'Upgrade payment no longer matches the authoritative calculation'; end if;
  update public.subscription_payments set payment_status='paid',billing_period_start=s.subscription_start,billing_period_end=s.subscription_end,updated_at=now() where id=pay.id returning * into pay;
  update public.canteen_subscriptions set plan_id=p.id,amount=p.annual_price,status='active',payment_status='paid',updated_at=now() where id=s.id; return pay;
 end if;
 cycle:=coalesce(p_billing_cycle,pay.billing_cycle,s.billing_cycle,'monthly');
 select * into p from public.subscription_plans where id=pay.plan_id and active;
 expected:=case when cycle='annual' then p.annual_price else p.monthly_price end;
 if round(pay.amount,2)<>round(expected,2) then raise exception 'Verified payment amount does not match the configured subscription price'; end if;
 start_at:=case when s.status='trial' and s.trial_end>now() then s.trial_end when s.subscription_end>now() then s.subscription_end else now() end;
 end_at:=case cycle when 'monthly' then start_at+interval '1 month' when 'annual' then start_at+interval '1 year' end;
 update public.subscription_payments set payment_status='paid',billing_cycle=cycle,billing_period_start=start_at,billing_period_end=end_at,updated_at=now() where id=pay.id returning * into pay;
 update public.canteen_subscriptions set plan_id=p.id,billing_cycle=cycle,status='active',payment_status='paid',subscription_start=start_at,subscription_end=end_at,amount=expected,currency=p.currency,updated_at=now() where id=s.id;
 return pay;
end $$;

create or replace function public.super_admin_set_payment_method(p_method_id uuid default null,p_provider text default 'manual',p_method_type text default 'upi',p_display_name text default null,p_upi_id text default null,p_active boolean default true,p_is_default boolean default false,p_action text default 'upsert')
returns public.subscription_payment_methods language plpgsql security definer set search_path='' as $$
declare m public.subscription_payment_methods;
begin
 if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
 if p_action='delete' then
  if exists(select 1 from public.subscription_payments where payment_method_id=p_method_id) then raise exception 'Payment method is referenced by payment history; deactivate it instead'; end if;
  delete from public.subscription_payment_methods where id=p_method_id returning * into m; if not found then raise exception 'Payment method not found'; end if; return m;
 elsif p_action='deactivate' then
  update public.subscription_payment_methods set active=false,is_default=false,updated_at=now() where id=p_method_id returning * into m; if not found then raise exception 'Payment method not found'; end if; return m;
 elsif p_action='upsert' then
  if p_provider<>'manual' then raise exception 'Razorpay is not configured in this phase'; end if;
  if p_method_type='upi' and nullif(trim(coalesce(p_upi_id,'')),'') is null then raise exception 'UPI ID is required'; end if;
  if p_is_default then update public.subscription_payment_methods set is_default=false,updated_at=now() where id<>coalesce(p_method_id,'00000000-0000-0000-0000-000000000000'::uuid); end if;
  if p_method_id is null then
   insert into public.subscription_payment_methods(provider,method_type,display_name,upi_id,active,is_default) values('manual',p_method_type,trim(p_display_name),nullif(trim(p_upi_id),''),p_active,p_is_default) returning * into m;
  else
   update public.subscription_payment_methods set provider='manual',method_type=p_method_type,display_name=trim(p_display_name),upi_id=nullif(trim(p_upi_id),''),active=p_active,is_default=p_is_default,updated_at=now() where id=p_method_id returning * into m;
  end if; return m;
 end if;
 raise exception 'Unsupported payment method action';
end $$;

revoke execute on function public.can_canteen_operate(uuid) from public,anon; grant execute on function public.can_canteen_operate(uuid) to authenticated;
revoke execute on function public.sync_subscription_statuses(uuid) from public,anon; grant execute on function public.sync_subscription_statuses(uuid) to authenticated;
revoke execute on function public.get_subscription_upgrade_quote(uuid,uuid) from public,anon; grant execute on function public.get_subscription_upgrade_quote(uuid,uuid) to authenticated;
revoke execute on function public.canteen_create_subscription_payment(uuid,text,date,text,text,uuid) from public,anon; grant execute on function public.canteen_create_subscription_payment(uuid,text,date,text,text,uuid) to authenticated;
revoke execute on function public.canteen_submit_plan_upgrade_payment(uuid,date,text,text,uuid) from public,anon; grant execute on function public.canteen_submit_plan_upgrade_payment(uuid,date,text,text,uuid) to authenticated;
revoke execute on function public.super_admin_review_subscription_payment(uuid,text,text) from public,anon; grant execute on function public.super_admin_review_subscription_payment(uuid,text,text) to authenticated;
revoke execute on function public.super_admin_set_payment_method(uuid,text,text,text,text,boolean,boolean,text) from public,anon; grant execute on function public.super_admin_set_payment_method(uuid,text,text,text,text,boolean,boolean,text) to authenticated;

commit;