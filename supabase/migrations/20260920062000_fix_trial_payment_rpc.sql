-- Fix the authoritative customer payment RPC variable/column name collision.
create or replace function public.canteen_create_subscription_payment(
 p_subscription_id uuid,p_billing_cycle text,p_payment_date date,p_reference text,
 p_note text default null,p_payment_method_id uuid default null
)
returns public.subscription_payments language plpgsql security definer set search_path=''
as $$
declare
 s public.canteen_subscriptions;
 p public.subscription_plans;
 m public.subscription_payment_methods;
 outp public.subscription_payments;
 pid uuid;
 expected numeric(12,2);
 period jsonb;
 v_payment_type text;
begin
 if auth.uid() is null or not public.is_active_canteen_admin() then raise exception 'Canteen Admin authorization required'; end if;
 select * into s from public.canteen_subscriptions where id=p_subscription_id and canteen_id=public.current_canteen_id() for update;
 if not found then raise exception 'Subscription not found'; end if;
 if s.status not in('trial','active','payment_pending','expired','suspended') then raise exception 'Payment is not currently required for this subscription'; end if;
 if p_billing_cycle not in('monthly','annual') or nullif(trim(coalesce(p_reference,'')),'') is null or p_payment_date is null then raise exception 'Payment details are required'; end if;
 if exists(select 1 from public.subscription_payments sp where sp.subscription_id=s.id and sp.payment_status='pending' and sp.payment_type<>'plan_upgrade') then raise exception 'A payment is already pending review for this subscription'; end if;
 pid:=case when s.plan_selection_mode='auto_range' then public.resolve_member_range_plan(s.canteen_id) else s.plan_id end;
 select * into p from public.subscription_plans where id=pid and active;
 if not found then raise exception 'Active subscription plan not found'; end if;
 expected:=case when p_billing_cycle='annual' then p.annual_price else p.monthly_price end;
 select * into m from public.subscription_payment_methods where id=coalesce(p_payment_method_id,(select id from public.subscription_payment_methods where active and is_default limit 1)) and active;
 if not found then raise exception 'No active payment method is configured'; end if;
 period:=public.resolve_subscription_billing_period(s.id,p_billing_cycle);
 v_payment_type:=case when s.status='active' then 'renewal' else 'subscription' end;
 insert into public.subscription_payments(canteen_id,subscription_id,plan_id,amount,currency,payment_date,payment_status,transaction_reference,payment_provider,payment_note,billing_cycle,payment_type,billing_period_start,billing_period_end,payment_method_id,payment_method_reference,payment_method_snapshot)
 values(s.canteen_id,s.id,p.id,expected,p.currency,p_payment_date::timestamptz,'pending',trim(p_reference),m.provider,nullif(trim(coalesce(p_note,'')),''),p_billing_cycle,v_payment_type,(period->>'billing_period_start')::timestamptz,(period->>'billing_period_end')::timestamptz,m.id,coalesce(m.upi_id,m.display_name),jsonb_build_object('id',m.id,'provider',m.provider,'method_type',m.method_type,'display_name',m.display_name,'upi_id',m.upi_id))
 returning * into outp;
 update public.canteen_subscriptions set payment_status='pending',updated_at=now() where id=s.id;
 return outp;
end $$;