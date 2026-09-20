-- Read-only Super Admin Usage & Audit RPC. Source of truth is existing orders, profiles, notifications, push outbox and subscription data.
create or replace function public.get_super_admin_usage_audit(p_start_date date default (now() at time zone 'Asia/Kolkata')::date,p_end_date date default (now() at time zone 'Asia/Kolkata')::date,p_canteen_id uuid default null)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_start date:=coalesce(p_start_date,(now() at time zone 'Asia/Kolkata')::date); v_end date:=coalesce(p_end_date,v_start); v_result jsonb;
begin
 if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
 if v_end<v_start then raise exception 'End date cannot be before start date'; end if;
 if v_end-v_start>366 then raise exception 'Date range cannot exceed 366 days'; end if;
 with eligible as (
  select c.id,c.name,c.created_at,c.archived from public.canteens c
  where not exists(select 1 from public.profiles p where p.id=c.owner_id and p.role='admin' and p.admin_role='super_admin' and p.status='active')
  and (p_canteen_id is null or c.id=p_canteen_id)
 ),mc as (
  select p.canteen_id,count(*) filter(where p.role='employee')::int total_members,count(*) filter(where p.role='employee' and p.status='active')::int active_members from public.profiles p join eligible e on e.id=p.canteen_id group by p.canteen_id
 ),po as (
  select o.* from public.orders o join eligible e on e.id=o.canteen_id where o.ordered_for between v_start and v_end and o.status='active'
 ),oa as (
  select canteen_id,count(*)::int period_orders,count(distinct employee_id)::int members_ordered,max(created_at) last_order_activity from po group by canteen_id
 ),na as (
  select n.canteen_id,count(*)::int notifications,max(n.created_at) last_notification_activity from public.notifications n join eligible e on e.id=n.canteen_id where (n.created_at at time zone 'Asia/Kolkata')::date between v_start and v_end group by n.canteen_id
 ),pa as (
  select n.canteen_id,count(*)::int push_generated,count(*) filter(where o.status='sent')::int push_sent,count(*) filter(where o.status='failed')::int push_failed from public.member_push_delivery_outbox o join public.notifications n on n.id=o.notification_id join eligible e on e.id=n.canteen_id where (o.created_at at time zone 'Asia/Kolkata')::date between v_start and v_end group by n.canteen_id
 ),subs as (
  select s.canteen_id,s.status,s.payment_status,s.subscription_end,s.trial_end,s.billing_cycle from public.canteen_subscriptions s join eligible e on e.id=s.canteen_id
 ),cr as (
  select e.id,e.name,e.created_at,e.archived,coalesce(mc.total_members,0) total_members,coalesce(mc.active_members,0) active_members,
  (select count(*)::int from public.orders o where o.canteen_id=e.id and o.ordered_for=(now() at time zone 'Asia/Kolkata')::date and o.status='active') orders_today,
  (select count(*)::int from public.orders o where o.canteen_id=e.id and o.ordered_for between greatest(v_start,(now() at time zone 'Asia/Kolkata')::date-6) and (now() at time zone 'Asia/Kolkata')::date and o.status='active') orders_7d,
  (select count(*)::int from public.orders o where o.canteen_id=e.id and o.ordered_for between greatest(v_start,(now() at time zone 'Asia/Kolkata')::date-29) and (now() at time zone 'Asia/Kolkata')::date and o.status='active') orders_30d,
  coalesce(oa.period_orders,0) period_orders,coalesce(oa.members_ordered,0) period_members_ordered,round(coalesce(oa.period_orders,0)::numeric/greatest((v_end-v_start)+1,1),2) average_orders_per_day,greatest(oa.last_order_activity,na.last_notification_activity) last_activity,coalesce(na.notifications,0) period_notifications,coalesce(pa.push_generated,0) push_generated,coalesce(pa.push_sent,0) push_sent,coalesce(pa.push_failed,0) push_failed,subs.status subscription_status,subs.payment_status,subs.subscription_end,subs.trial_end,subs.billing_cycle
  from eligible e left join mc on mc.canteen_id=e.id left join oa on oa.canteen_id=e.id left join na on na.canteen_id=e.id left join pa on pa.canteen_id=e.id left join subs on subs.canteen_id=e.id
 ),daily as (
  select gs::date day_bucket,(select count(*) from po where ordered_for=gs::date)::int orders,(select count(distinct canteen_id) from po where ordered_for=gs::date)::int active_canteens,(select count(*) from public.notifications n join eligible e on e.id=n.canteen_id where (n.created_at at time zone 'Asia/Kolkata')::date=gs::date)::int notifications from generate_series(v_start,v_end,interval '1 day') gs
 ),hourly as (
  select extract(hour from (created_at at time zone 'Asia/Kolkata'))::int hour_bucket,count(*)::int orders from po group by 1 order by 1
 ),nt as (
  select count(*)::int total,count(*) filter(where notification_type like '%order%' or notification_type like '%reminder%')::int order_related from public.notifications n join eligible e on e.id=n.canteen_id where (n.created_at at time zone 'Asia/Kolkata')::date between v_start and v_end
 ),pt as (
  select count(*)::int generated,count(*) filter(where o.status='sent')::int sent,count(*) filter(where o.status='failed')::int failed from public.member_push_delivery_outbox o join public.notifications n on n.id=o.notification_id join eligible e on e.id=n.canteen_id where (o.created_at at time zone 'Asia/Kolkata')::date between v_start and v_end
 ),pay as (
  select count(*)::int payments,coalesce(sum(p.amount) filter(where p.payment_status='paid'),0)::numeric paid_amount from public.subscription_payments p join eligible e on e.id=p.canteen_id where coalesce(p.payment_date,p.created_at at time zone 'Asia/Kolkata')::date between v_start and v_end
 ),tot as (
  select count(*)::int total_canteens,count(*) filter(where coalesce(s.status,'')='active')::int active_canteens,count(*) filter(where coalesce(s.status,'')='trial')::int trial_canteens,count(*) filter(where coalesce(s.status,'') in ('expired','suspended'))::int expired_suspended_canteens from eligible e left join subs s on s.canteen_id=e.id
 ),mem as (
  select coalesce(sum(total_members),0)::int total_members,coalesce(sum(active_members),0)::int active_members from mc
 )
 select jsonb_build_object('range',jsonb_build_object('start_date',v_start,'end_date',v_end,'timezone','Asia/Kolkata'),'overview',(select jsonb_build_object('total_canteens',t.total_canteens,'active_canteens',t.active_canteens,'trial_canteens',t.trial_canteens,'expired_suspended_canteens',t.expired_suspended_canteens,'total_members',m.total_members,'active_members',m.active_members,'orders_today',(select count(*) from public.orders o join eligible e on e.id=o.canteen_id where o.ordered_for=(now() at time zone 'Asia/Kolkata')::date and o.status='active'),'orders_this_period',(select count(*) from po),'members_ordered_this_period',(select count(distinct employee_id) from po),'active_canteens_in_period',(select count(distinct canteen_id) from po),'notifications_generated',nt.total,'order_related_notifications',nt.order_related,'push_generated',pt.generated,'push_sent',pt.sent,'push_failed',pt.failed,'payment_count',pay.payments,'paid_amount',pay.paid_amount) from tot t cross join mem m cross join nt cross join pt cross join pay),'canteens',(select coalesce(jsonb_agg(to_jsonb(r) order by r.name),'[]'::jsonb) from cr r),'daily',(select coalesce(jsonb_agg(to_jsonb(d) order by d.day_bucket),'[]'::jsonb) from daily d),'hourly',(select coalesce(jsonb_agg(to_jsonb(h) order by h.hour_bucket),'[]'::jsonb) from hourly h),'technical',jsonb_build_object('database_metrics','not_currently_measurable_from_application_data','server_cpu','not_currently_measurable','server_memory','not_currently_measurable','api_latency','not_currently_measurable','edge_function_errors','not_currently_measurable')) into v_result;
 return v_result;
end;$fn$;
revoke all on function public.get_super_admin_usage_audit(date,date,uuid) from public,anon,authenticated;
grant execute on function public.get_super_admin_usage_audit(date,date,uuid) to authenticated;