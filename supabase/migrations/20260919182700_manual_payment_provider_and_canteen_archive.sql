alter table public.subscription_payments
  add column if not exists payment_provider text not null default 'manual',
  add column if not exists payment_note text;

alter table public.subscription_payments
  drop constraint if exists subscription_payments_payment_provider_check;
alter table public.subscription_payments
  add constraint subscription_payments_payment_provider_check
  check (payment_provider in ('manual','razorpay'));

alter table public.canteens
  add column if not exists archived boolean not null default false;

create table if not exists public.subscription_payment_settings (
  id boolean primary key default true,
  payment_provider text not null default 'manual',
  manual_payment_enabled boolean not null default true,
  razorpay_enabled boolean not null default false,
  upi_id text,
  payment_display_name text,
  payment_instructions text,
  bank_payment_details text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_payment_settings_singleton check (id = true),
  constraint subscription_payment_settings_provider_check check (payment_provider in ('manual','razorpay')),
  constraint subscription_payment_settings_razorpay_disabled_check check (razorpay_enabled = false or payment_provider = 'razorpay')
);

insert into public.subscription_payment_settings(
  id,payment_provider,manual_payment_enabled,razorpay_enabled,
  upi_id,payment_display_name,payment_instructions,bank_payment_details
)
values (
  true,'manual',true,false,null,'GoCanteen',
  'Make the subscription payment using the payment details shown here, then submit the amount, payment date and UTR / Transaction ID. Payment remains pending until Super Admin verification.',
  null
)
on conflict (id) do nothing;

alter table public.subscription_payment_settings enable row level security;

drop policy if exists subscription_payment_settings_super_admin_select on public.subscription_payment_settings;
drop policy if exists subscription_payment_settings_super_admin_write on public.subscription_payment_settings;
drop policy if exists subscription_payment_settings_canteen_admin_select on public.subscription_payment_settings;
drop policy if exists subscription_payment_settings_select on public.subscription_payment_settings;

create policy subscription_payment_settings_select
on public.subscription_payment_settings for select to authenticated
using ((select public.is_super_admin()) or (select public.is_active_canteen_admin()));

revoke all on public.subscription_payment_settings from public, anon, authenticated;
grant select on public.subscription_payment_settings to authenticated;

create or replace function public.super_admin_update_subscription_payment_settings(
  p_payment_provider text default 'manual',
  p_manual_payment_enabled boolean default true,
  p_upi_id text default null,
  p_payment_display_name text default null,
  p_payment_instructions text default null,
  p_bank_payment_details text default null,
  p_razorpay_enabled boolean default false
)
returns public.subscription_payment_settings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_settings public.subscription_payment_settings;
begin
  if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
  if p_payment_provider not in ('manual','razorpay') then raise exception 'Unsupported payment provider'; end if;
  if p_payment_provider='razorpay' and not coalesce(p_razorpay_enabled,false) then raise exception 'Razorpay provider cannot be selected while Razorpay is disabled'; end if;
  if coalesce(p_razorpay_enabled,false) then raise exception 'Razorpay is not configured in this phase'; end if;
  update public.subscription_payment_settings
  set payment_provider='manual',
      manual_payment_enabled=coalesce(p_manual_payment_enabled,true),
      razorpay_enabled=false,
      upi_id=nullif(trim(coalesce(p_upi_id,'')),''),
      payment_display_name=nullif(trim(coalesce(p_payment_display_name,'')),''),
      payment_instructions=nullif(trim(coalesce(p_payment_instructions,'')),''),
      bank_payment_details=nullif(trim(coalesce(p_bank_payment_details,'')),''),
      updated_at=now()
  where id=true
  returning * into v_settings;
  return v_settings;
end;
$function$;

revoke execute on function public.super_admin_update_subscription_payment_settings(text,boolean,text,text,text,text,boolean) from public, anon;
grant execute on function public.super_admin_update_subscription_payment_settings(text,boolean,text,text,text,text,boolean) to authenticated;

create or replace function public.super_admin_archive_canteen(p_canteen_id uuid)
returns public.canteens language plpgsql security definer set search_path = ''
as $function$
declare v_canteen public.canteens;
begin
  if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
  select * into v_canteen from public.canteens where id=p_canteen_id for update;
  if not found then raise exception 'Canteen not found'; end if;
  if v_canteen.owner_id=(select auth.uid()) then raise exception 'Super Admin Canteen cannot be archived'; end if;
  update public.canteens set archived=true,updated_at=now() where id=p_canteen_id returning * into v_canteen;
  return v_canteen;
end;
$function$;

create or replace function public.super_admin_restore_canteen(p_canteen_id uuid)
returns public.canteens language plpgsql security definer set search_path = ''
as $function$
declare v_canteen public.canteens;
begin
  if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
  select * into v_canteen from public.canteens where id=p_canteen_id for update;
  if not found then raise exception 'Canteen not found'; end if;
  update public.canteens set archived=false,updated_at=now() where id=p_canteen_id returning * into v_canteen;
  return v_canteen;
end;
$function$;

revoke execute on function public.super_admin_archive_canteen(uuid) from public, anon;
grant execute on function public.super_admin_archive_canteen(uuid) to authenticated;
revoke execute on function public.super_admin_restore_canteen(uuid) from public, anon;
grant execute on function public.super_admin_restore_canteen(uuid) to authenticated;

create or replace function public.can_canteen_operate(p_canteen_id uuid default null)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case
    when auth.uid() is null then false
    when exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin' and p.admin_role='super_admin' and p.status='active') then true
    else exists (
      select 1
      from public.profiles p
      join public.canteen_subscriptions s on s.canteen_id=p.canteen_id
      join public.canteens c on c.id=p.canteen_id
      where p.id=(select auth.uid())
        and p.status='active'
        and p.canteen_id=coalesce(p_canteen_id,p.canteen_id)
        and c.archived=false
        and case s.status
          when 'payment_pending' then true
          when 'trial' then s.trial_end is not null and s.trial_end > now()
          when 'active' then s.subscription_end is not null and s.subscription_end > now()
          else false
        end
    )
  end
$$;

create or replace function public.canteen_submit_subscription_payment(
  p_subscription_id uuid,p_amount numeric,p_reference text,p_payment_date date,p_note text default null
)
returns public.subscription_payments language plpgsql security definer set search_path = ''
as $function$
declare v_sub public.canteen_subscriptions; v_payment public.subscription_payments; v_canteen_id uuid; v_original_status text;
begin
  if auth.uid() is null or not public.is_active_canteen_admin() then raise exception 'Canteen Admin authorization required'; end if;
  v_canteen_id:=public.current_canteen_id();
  if v_canteen_id is null then raise exception 'Canteen is not configured'; end if;
  if exists(select 1 from public.canteens where id=v_canteen_id and archived=true) then raise exception 'Archived Canteens cannot submit subscription payments'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Payment amount must be greater than zero'; end if;
  if nullif(trim(coalesce(p_reference,'')),'') is null then raise exception 'Payment reference is required'; end if;
  if p_payment_date is null then raise exception 'Payment date is required'; end if;
  select * into v_sub from public.canteen_subscriptions where id=p_subscription_id and canteen_id=v_canteen_id for update;
  if not found then raise exception 'Subscription not found'; end if;
  if v_sub.status not in ('payment_pending','expired','suspended') then raise exception 'Payment is not currently required for this subscription'; end if;
  v_original_status:=v_sub.status;
  if exists(select 1 from public.subscription_payments where subscription_id=v_sub.id and payment_status='pending') then raise exception 'A payment is already pending review for this subscription'; end if;
  insert into public.subscription_payments(canteen_id,subscription_id,plan_id,amount,currency,payment_date,payment_status,transaction_reference,payment_provider,payment_note)
  values(v_canteen_id,v_sub.id,v_sub.plan_id,p_amount,v_sub.currency,p_payment_date::timestamptz,'pending',trim(p_reference),'manual',nullif(trim(coalesce(p_note,'')),''))
  returning * into v_payment;
  update public.canteen_subscriptions set payment_status='pending',status=case when v_original_status='suspended' then 'suspended' else 'payment_pending' end,updated_at=now() where id=v_sub.id;
  return v_payment;
end;
$function$;

drop function if exists public.canteen_submit_subscription_payment(uuid,numeric,text,date);
revoke execute on function public.canteen_submit_subscription_payment(uuid,numeric,text,date,text) from public, anon;
grant execute on function public.canteen_submit_subscription_payment(uuid,numeric,text,date,text) to authenticated;

notify pgrst,'reload schema';