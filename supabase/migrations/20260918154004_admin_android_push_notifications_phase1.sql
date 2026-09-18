-- Phase 1: Admin Android push notifications. Reuse existing notifications/outbox/FCM pipeline.
create schema if not exists private;

create or replace function public.register_admin_push_installation(
  p_installation_id text,
  p_fcm_token text,
  p_platform text default 'android',
  p_binding_generation bigint default 1
) returns jsonb
language plpgsql
security definer
set search_path=''
as $fn$
declare
  v_profile public.profiles%rowtype;
  v_row public.member_push_installations%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
  if length(trim(coalesce(p_installation_id,''))) < 8 then raise exception 'Invalid installation id.'; end if;
  if length(trim(coalesce(p_fcm_token,''))) < 20 then raise exception 'Invalid FCM token.'; end if;
  if p_platform <> 'android' then raise exception 'Unsupported push platform.'; end if;
  if coalesce(p_binding_generation,0) < 1 then raise exception 'Invalid binding generation.'; end if;
  select * into v_profile from public.profiles where id=(select auth.uid()) and role='admin' and status='active';
  if not found or v_profile.canteen_id is null then raise exception 'Only active Admins can register push installations.'; end if;
  insert into public.member_push_installations(installation_id,profile_id,canteen_id,fcm_token,platform,is_active,binding_generation,created_at,updated_at,last_seen_at)
  values(trim(p_installation_id),v_profile.id,v_profile.canteen_id,trim(p_fcm_token),p_platform,true,p_binding_generation,now(),now(),now())
  on conflict(installation_id) do update set profile_id=excluded.profile_id,canteen_id=excluded.canteen_id,fcm_token=excluded.fcm_token,platform=excluded.platform,is_active=true,binding_generation=excluded.binding_generation,updated_at=now(),last_seen_at=now()
  where public.member_push_installations.binding_generation <= excluded.binding_generation
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.member_push_installations where installation_id=trim(p_installation_id);
    return jsonb_build_object('ok',false,'stale',true,'installation_id',p_installation_id,'binding_generation',v_row.binding_generation);
  end if;
  return jsonb_build_object('ok',true,'stale',false,'installation_id',v_row.installation_id,'profile_id',v_row.profile_id,'canteen_id',v_row.canteen_id,'binding_generation',v_row.binding_generation);
end;
$fn$;
revoke all on function public.register_admin_push_installation(text,text,text,bigint) from public,anon;
grant execute on function public.register_admin_push_installation(text,text,text,bigint) to authenticated;

create or replace function public.deactivate_admin_push_installation(p_installation_id text,p_binding_generation bigint default 1)
returns boolean language plpgsql security definer set search_path=''
as $fn$
begin
  if (select auth.uid()) is null then return false; end if;
  update public.member_push_installations mpi set is_active=false,updated_at=now(),last_seen_at=now()
  where mpi.installation_id=trim(coalesce(p_installation_id,''))
    and mpi.binding_generation <= coalesce(p_binding_generation,0)
    and mpi.profile_id=(select auth.uid())
    and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin' and p.status='active' and p.canteen_id=mpi.canteen_id);
  return found;
end;
$fn$;
revoke all on function public.deactivate_admin_push_installation(text,bigint) from public,anon;
grant execute on function public.deactivate_admin_push_installation(text,bigint) to authenticated;

create or replace function private.create_admin_notification(
  p_canteen_id uuid,p_permission text,p_notification_type text,p_title text,p_message text,
  p_payload jsonb default '{}'::jsonb,p_event_key text default null
) returns integer language plpgsql security definer set search_path=''
as $fn$
declare v_payload jsonb:=coalesce(p_payload,'{}'::jsonb); v_count integer:=0;
begin
  if p_canteen_id is null then return 0; end if;
  if p_event_key is not null and length(trim(p_event_key))>0 then v_payload:=v_payload||jsonb_build_object('event_key',p_event_key); end if;
  insert into public.notifications(recipient_id,notification_type,title,message,payload,created_at,canteen_id)
  select p.id,p_notification_type,p_title,p_message,v_payload,now(),p_canteen_id
  from public.profiles p
  where p.role='admin' and p.status='active' and p.canteen_id=p_canteen_id
    and (p.admin_role in ('owner','master_admin') or (p_permission is not null and exists(
      select 1 from public.admin_permissions ap where ap.admin_id=p.id and ap.canteen_id=p_canteen_id and ap.permission=p_permission and ap.enabled)))
  on conflict do nothing;
  get diagnostics v_count=row_count; return v_count;
end;
$fn$;
revoke all on function private.create_admin_notification(uuid,text,text,text,text,jsonb,text) from public,anon,authenticated;

create or replace function public.enqueue_member_push_delivery()
returns trigger language plpgsql security definer set search_path=''
as $fn$
begin
  insert into public.member_push_delivery_outbox(notification_id,installation_id,profile_id)
  select new.id,mpi.id,new.recipient_id
  from public.member_push_installations mpi join public.profiles p on p.id=mpi.profile_id
  where mpi.profile_id=new.recipient_id and mpi.canteen_id=new.canteen_id and mpi.is_active=true
    and p.status='active' and p.canteen_id=new.canteen_id and p.role in ('employee','admin')
  on conflict(notification_id,installation_id) do nothing;
  return new;
end;
$fn$;
revoke all on function public.enqueue_member_push_delivery() from public,anon,authenticated;

create or replace function public.notify_bill_payment_status_change()
returns trigger language plpgsql security definer set search_path='public'
as $fn$
declare v_pending_count integer;
begin
  if new.status='pending_verification' and new.status is distinct from old.status then
    perform public.create_member_notification(new.employee_id,'payment_submitted','Payment Submitted','Your payment has been submitted for verification.',
      jsonb_build_object('bill_id',new.bill_id,'payment_id',new.id,'request_sequence',new.request_sequence,'amount',new.amount),
      format('payment_submitted:%s:%s',new.id,coalesce(new.confirmed_at::text,new.updated_at::text)));
    select count(*) into v_pending_count from public.bill_payments p where p.canteen_id=new.canteen_id and p.status='pending_verification';
    perform private.create_admin_notification(new.canteen_id,'payments','payment_pending_verification','Payment Verification Required',
      format('%s submitted a payment of ₹%s. %s payments are now pending verification.',coalesce(new.member_name_snapshot,'Member'),to_char(new.amount,'FM999999990.00'),v_pending_count),
      jsonb_build_object('screen','payment_verification','payment_id',new.id,'bill_id',new.bill_id,'amount',new.amount,'pending_payment_count',v_pending_count),
      format('payment_pending:%s',new.id));
  elsif new.status='rejected' and new.status is distinct from old.status then
    perform public.create_member_notification(new.employee_id,'payment_status_updated','Payment Rejected','Your payment was rejected. Please review the payment request and try again.',
      jsonb_build_object('bill_id',new.bill_id,'payment_id',new.id,'request_sequence',new.request_sequence,'status','rejected','amount',new.amount),
      format('payment_status:%s:rejected:%s',new.id,new.updated_at::text));
  end if;
  return new;
end;
$fn$;

create or replace function public.gocanteen_notification_scheduler()
returns void language plpgsql security definer set search_path='public'
as $fn$
declare
  v_now timestamp:=now() at time zone 'Asia/Kolkata'; v_today date:=v_now::date; r record;
  v_target_date date; v_order_label text; v_member_orders integer; v_guest_orders integer;
  v_food_items integer; v_total_value numeric; v_weekday smallint; v_holiday boolean;
begin
  if v_now::time>=time '18:00' then
    for r in select hd.id,hd.canteen_id,hd.holiday_date from public.holiday_dates hd where hd.holiday_date=v_today+1 loop
      perform public.notify_canteen_employees_for_canteen(r.canteen_id,'holiday_tomorrow:'||r.id::text,'holiday_tomorrow','Holiday Tomorrow',
        format('Tomorrow is a holiday — %s.',to_char(r.holiday_date,'DD Mon YYYY')),
        jsonb_build_object('holiday_date',r.holiday_date::text,'holiday_id',r.id,'holiday_source','declared'));
    end loop;
  end if;

  for r in select canteen_id,enabled,start_time,end_time,coalesce(order_for,'today') as order_for from public.order_window_settings
    where coalesce(enabled,false) and start_time is not null and end_time is not null loop
    v_target_date:=case when r.order_for='tomorrow' then v_today+1 else v_today end;
    v_order_label:=case when r.order_for='tomorrow' then 'Tomorrow''s' else 'Today''s' end;

    if to_char(v_now,'HH24:MI')=to_char(r.start_time,'HH24:MI') then
      perform public.notify_canteen_employees_for_canteen(r.canteen_id,'order_time_open:'||r.canteen_id::text||':'||v_today::text,'order_time_open','Order Time Open',
        'Today''s orders are now open.',jsonb_build_object('business_date',v_today::text,'order_for',r.order_for,'order_window_state','open'));
    end if;
    if to_char(v_now,'HH24:MI')=to_char(r.end_time-interval '10 minutes','HH24:MI') then
      perform public.notify_canteen_employees_for_canteen(r.canteen_id,'order_time_closing_soon:'||r.canteen_id::text||':'||v_today::text||':'||r.order_for,'order_time_closing_soon','Order Time Closing Soon',
        'Orders close in 10 minutes.',jsonb_build_object('business_date',v_today::text,'order_for',r.order_for,'order_window_state','closing_soon'));
    end if;
    if to_char(v_now,'HH24:MI')=to_char(r.end_time,'HH24:MI') then
      perform public.notify_canteen_employees_for_canteen(r.canteen_id,'order_time_closed:'||r.canteen_id::text||':'||v_today::text,'order_time_closed','Order Time Closed',
        'Today''s orders are now closed.',jsonb_build_object('business_date',v_today::text,'order_for',r.order_for,'order_window_state','closed'));

      select count(*) filter(where coalesce(x.member_items,0)>0),count(*) filter(where coalesce(x.guest_items,0)>0),
        coalesce(sum(x.total_items),0),coalesce(sum(x.total_value),0)
      into v_member_orders,v_guest_orders,v_food_items,v_total_value
      from (select o.id,count(*) filter(where oi.item_source<>'guest') member_items,count(*) filter(where oi.item_source='guest') guest_items,
        coalesce(sum(oi.quantity),0) total_items,coalesce(sum(coalesce(oi.line_total,oi.quantity*oi.unit_price)),0) total_value
        from public.orders o join public.order_items oi on oi.order_id=o.id
        where o.canteen_id=r.canteen_id and o.ordered_for=v_target_date and o.status='active' group by o.id) x;

      perform private.create_admin_notification(r.canteen_id,'orders','order_window_closed',v_order_label||' Order Closed',
        format('%s member orders%s%s%s.',coalesce(v_member_orders,0),
          case when coalesce(v_guest_orders,0)>0 then format(', %s guest orders',v_guest_orders) else '' end,
          case when coalesce(v_food_items,0)>0 then format(', %s food items',v_food_items) else '' end,
          case when coalesce(v_total_value,0)>0 then format(', total ₹%s',to_char(v_total_value,'FM999999990.00')) else '' end),
        jsonb_build_object('screen','orders','business_date',v_target_date::text,'order_for',r.order_for,
          'member_order_count',coalesce(v_member_orders,0),'guest_order_count',coalesce(v_guest_orders,0),
          'food_item_quantity',coalesce(v_food_items,0),'total_order_value',coalesce(v_total_value,0)),
        format('order_window_closed:%s:%s:%s',r.canteen_id::text,v_target_date::text,r.order_for));
    end if;

    if to_char(v_now,'HH24:MI')=to_char(r.start_time-interval '30 minutes','HH24:MI') then
      v_weekday:=extract(dow from v_target_date)::smallint;
      select exists(select 1 from public.holiday_dates h where h.canteen_id=r.canteen_id and h.holiday_date=v_target_date) into v_holiday;
      if not coalesce(v_holiday,false) and not exists(
        select 1 from public.weekly_menu wm where wm.canteen_id=r.canteen_id and wm.weekday=v_weekday and wm.active=true) then
        perform private.create_admin_notification(r.canteen_id,'menu','menu_not_configured','Menu Not Configured',
          format('%s''s menu has not been configured yet.',to_char(v_target_date,'FMDay')),
          jsonb_build_object('screen','menu','weekday',v_weekday,'business_date',v_target_date::text,'order_for',r.order_for),
          format('menu_not_configured:%s:%s',r.canteen_id::text,v_target_date::text));
      end if;
    end if;
  end loop;
end;
$fn$;
revoke all on function public.gocanteen_notification_scheduler() from public,anon,authenticated;
