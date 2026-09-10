-- GO CANTEEN: extend the existing Supabase notification architecture.
-- Notifications remain tenant/member scoped; read_at is history state, not deletion.

create unique index if not exists notifications_recipient_event_key_unique
  on public.notifications(recipient_id,((payload->>'event_key')))
  where payload ? 'event_key';

create or replace function public.create_member_notification(
  p_recipient_id uuid,
  p_notification_type text,
  p_title text,
  p_message text,
  p_payload jsonb default '{}'::jsonb,
  p_event_key text default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_canteen uuid;
  v_id uuid;
  v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
begin
  select canteen_id into v_canteen from public.profiles
  where id=p_recipient_id and role='employee' and status='active';
  if v_canteen is null then return null; end if;
  if p_event_key is not null and length(trim(p_event_key))>0 then
    v_payload:=v_payload||jsonb_build_object('event_key',p_event_key);
  end if;
  insert into public.notifications(recipient_id,notification_type,title,message,payload,created_at,canteen_id)
  values(p_recipient_id,p_notification_type,p_title,p_message,v_payload,now(),v_canteen)
  on conflict do nothing
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.notify_canteen_employees_for_canteen(
  p_canteen_id uuid,p_event_key text,p_notification_type text,p_title text,p_message text,p_payload jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare v_count integer:=0;r record;
begin
  if p_canteen_id is null then return 0; end if;
  for r in select id from public.profiles where canteen_id=p_canteen_id and role='employee' and status='active' loop
    if public.create_member_notification(r.id,p_notification_type,p_title,p_message,p_payload,p_event_key) is not null then v_count:=v_count+1; end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.notify_canteen_employees(
  p_event_key text,p_notification_type text,p_title text,p_message text,p_payload jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare v_canteen uuid:=public.current_canteen_id();v_count integer:=0;r record;
begin
  if v_canteen is null then return 0; end if;
  for r in select id from public.profiles where canteen_id=v_canteen and role='employee' and status='active' loop
    if public.create_member_notification(r.id,p_notification_type,p_title,p_message,p_payload,p_event_key) is not null then v_count:=v_count+1; end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.create_member_notification(uuid,text,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.notify_canteen_employees_for_canteen(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_member_notification(uuid,text,text,text,jsonb,text) to postgres;
grant execute on function public.notify_canteen_employees_for_canteen(uuid,text,text,text,text,jsonb) to postgres;
grant execute on function public.notify_canteen_employees(text,text,text,text,jsonb) to authenticated;

create or replace function public.admin_add_declared_holiday(p_date date)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_canteen uuid:=public.current_canteen_id();v_inserted date;v_count integer:=0;
begin
  if v_canteen is null or not public.has_admin_permission('holidays') then raise exception 'Holiday management permission required.'; end if;
  if p_date is null then raise exception 'Holiday date is required.'; end if;
  if p_date<(now() at time zone 'Asia/Kolkata')::date then raise exception 'Holiday date cannot be in the past.'; end if;
  insert into public.holiday_dates(canteen_id,holiday_date,created_by)
  values(v_canteen,p_date,auth.uid()) on conflict(canteen_id,holiday_date) do nothing returning holiday_date into v_inserted;
  if v_inserted is not null then
    v_count:=public.notify_canteen_employees('holiday_declared:'||p_date::text||':'||gen_random_uuid()::text,'holiday_declared','Holiday Declared',format('%s is declared a holiday. Orders are not available on this date.',to_char(p_date,'DD Mon YYYY')),jsonb_build_object('holiday_date',p_date::text,'holiday_source','declared'));
  end if;
  return jsonb_build_object('holiday_date',to_char(p_date,'YYYY-MM-DD'),'created',v_inserted is not null,'notifications_created',v_count);
end;
$$;
revoke all on function public.admin_add_declared_holiday(date) from public;
grant execute on function public.admin_add_declared_holiday(date) to authenticated;

create or replace function public.admin_remove_declared_holiday(p_date date)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_canteen uuid:=public.current_canteen_id();v_id uuid;v_date date;v_count integer:=0;
begin
  if v_canteen is null or not public.has_admin_permission('holidays') then raise exception 'Holiday management permission required.'; end if;
  select id,holiday_date into v_id,v_date from public.holiday_dates where canteen_id=v_canteen and holiday_date=p_date for update;
  if v_id is null then return jsonb_build_object('removed',false,'notifications_created',0); end if;
  delete from public.holiday_dates where id=v_id;
  v_count:=public.notify_canteen_employees('holiday_cancelled:'||v_id::text,'holiday_cancelled','Holiday Cancelled',format('%s is no longer a holiday.',to_char(v_date,'DD Mon YYYY')),jsonb_build_object('holiday_date',v_date::text,'holiday_source','declared','holiday_id',v_id));
  return jsonb_build_object('removed',true,'notifications_created',v_count,'holiday_date',v_date::text);
end;
$$;
revoke all on function public.admin_remove_declared_holiday(date) from public;
grant execute on function public.admin_remove_declared_holiday(date) to authenticated;

create or replace function public.gocanteen_notification_scheduler()
returns void
language plpgsql
security definer
set search_path=public
as $$
declare v_now timestamp:=now() at time zone 'Asia/Kolkata';v_today date:=v_now::date;r record;
begin
  if to_char(v_now,'HH24:MI')='18:00' then
    for r in select hd.id,hd.canteen_id,hd.holiday_date from public.holiday_dates hd where hd.holiday_date=v_today+1 loop
      perform public.notify_canteen_employees_for_canteen(r.canteen_id,'holiday_tomorrow:'||r.id::text,'holiday_tomorrow','Holiday Tomorrow',format('Tomorrow is a holiday — %s.',to_char(r.holiday_date,'DD Mon YYYY')),jsonb_build_object('holiday_date',r.holiday_date::text,'holiday_id',r.id,'holiday_source','declared'));
    end loop;
  end if;
  for r in select canteen_id,enabled,start_time,end_time from public.order_window_settings where coalesce(enabled,false) and start_time is not null and end_time is not null loop
    if to_char(v_now,'HH24:MI')=to_char(r.start_time,'HH24:MI') then
      perform public.notify_canteen_employees_for_canteen(r.canteen_id,'order_time_open:'||r.canteen_id::text||':'||v_today::text,'order_time_open','Order Time Open','Today''s orders are now open.',jsonb_build_object('business_date',v_today::text,'order_window_state','open'));
    end if;
    if to_char(v_now,'HH24:MI')=to_char(r.end_time,'HH24:MI') then
      perform public.notify_canteen_employees_for_canteen(r.canteen_id,'order_time_closed:'||r.canteen_id::text||':'||v_today::text,'order_time_closed','Order Time Closed','Today''s orders are now closed.',jsonb_build_object('business_date',v_today::text,'order_window_state','closed'));
    end if;
  end loop;
end;
$$;
revoke all on function public.gocanteen_notification_scheduler() from public,anon,authenticated;
do $$ begin if not exists(select 1 from cron.job where jobname='gocanteen-notification-scheduler') then perform cron.schedule('gocanteen-notification-scheduler','* * * * *','select public.gocanteen_notification_scheduler();'); end if; end $$;

create or replace function public.notify_new_bill_payment_batch()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_type text;v_title text;
begin
  if new.status<>'unpaid' then return new; end if;
  v_type:=case when coalesce(new.request_sequence,1)=1 then 'monthly_bill_published' else 'additional_bill_published' end;
  v_title:=case when coalesce(new.request_sequence,1)=1 then 'Bill Published' else 'Additional Bill Published' end;
  perform public.create_member_notification(new.employee_id,v_type,v_title,case when coalesce(new.request_sequence,1)=1 then format('Bill published — Amount: ₹%s.',to_char(new.amount,'FM999999990.00')) else format('Additional bill published — ₹%s.',to_char(new.amount,'FM999999990.00')) end,jsonb_build_object('bill_id',new.bill_id,'payment_id',new.id,'request_sequence',new.request_sequence,'amount',new.amount,'covered_through',new.covered_through),format('bill_batch:%s:%s',new.bill_id,coalesce(new.request_sequence,1)));
  return new;
end;$$;
drop trigger if exists trg_notify_new_bill_payment_batch on public.bill_payments;
create trigger trg_notify_new_bill_payment_batch after insert on public.bill_payments for each row execute function public.notify_new_bill_payment_batch();

create or replace function public.notify_bill_payment_status_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='pending_verification' and new.status is distinct from old.status then
    perform public.create_member_notification(new.employee_id,'payment_submitted','Payment Submitted','Your payment has been submitted for verification.',jsonb_build_object('bill_id',new.bill_id,'payment_id',new.id,'request_sequence',new.request_sequence,'amount',new.amount),format('payment_submitted:%s:%s',new.id,coalesce(new.confirmed_at::text,new.updated_at::text)));
  elsif new.status='rejected' and new.status is distinct from old.status then
    perform public.create_member_notification(new.employee_id,'payment_status_updated','Payment Rejected','Your payment was rejected. Please review the payment request and try again.',jsonb_build_object('bill_id',new.bill_id,'payment_id',new.id,'request_sequence',new.request_sequence,'status','rejected','amount',new.amount),format('payment_status:%s:rejected:%s',new.id,new.updated_at::text));
  end if;
  return new;
end;$$;
drop trigger if exists trg_notify_bill_payment_status_change on public.bill_payments;
create trigger trg_notify_bill_payment_status_change after update of status on public.bill_payments for each row execute function public.notify_bill_payment_status_change();

drop trigger if exists trg_notify_admin_order_cancelled on public.orders;
drop function if exists public.notify_admin_order_cancelled();

create or replace function public.notify_admin_order_item_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_order_id uuid:=coalesce(new.order_id,old.order_id);v_order public.orders%rowtype;
begin
  if not public.is_admin_user() then return coalesce(new,old); end if;
  select * into v_order from public.orders where id=v_order_id;
  if v_order.id is not null and v_order.status='active' and tg_op<>'INSERT' then
    perform public.create_member_notification(v_order.employee_id,'order_updated','Order Updated',format('Your order for %s was updated by Admin.',to_char(v_order.ordered_for,'DD Mon YYYY')),jsonb_build_object('order_id',v_order.id,'order_date',v_order.ordered_for::text),format('order_updated:%s:%s',v_order.id,txid_current()::text));
  end if;
  return coalesce(new,old);
end;$$;
drop trigger if exists trg_notify_admin_order_item_change on public.order_items;
create trigger trg_notify_admin_order_item_change after update or delete on public.order_items for each row execute function public.notify_admin_order_item_change();

create or replace function public.notify_admin_menu_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_name text:=coalesce(new.item_name,old.item_name,old.item_code,new.item_code);v_message text;v_key text:=format('menu:%s:%s',coalesce(new.item_code,old.item_code),txid_current()::text);
begin
  if not public.is_admin_user() then return coalesce(new,old); end if;
  if tg_op='INSERT' then v_message:=format('Menu Updated — %s added at ₹%s.',v_name,to_char(coalesce(new.unit_price,0),'FM999999990.00'));
  elsif coalesce(new.archived,false) and not coalesce(old.archived,false) then v_message:=format('Menu Updated — %s was removed from the member menu.',v_name);
  elsif new.unit_price is distinct from old.unit_price then v_message:=format('Menu Updated — %s price changed to ₹%s.',v_name,to_char(coalesce(new.unit_price,0),'FM999999990.00'));
  elsif new.active is distinct from old.active then v_message:=format('Menu Updated — %s is now %s.',v_name,case when coalesce(new.active,false) then 'available' else 'unavailable' end);
  elsif new.item_name is distinct from old.item_name then v_message:=format('Menu Updated — %s name was changed.',v_name);
  else return coalesce(new,old); end if;
  perform public.notify_canteen_employees(v_key,'menu_updated','Menu Updated',v_message,jsonb_build_object('item_code',coalesce(new.item_code,old.item_code),'item_name',v_name,'unit_price',coalesce(new.unit_price,old.unit_price),'change','member_facing'));
  return coalesce(new,old);
end;$$;
drop trigger if exists trg_notify_admin_menu_change on public.menu_prices;
create trigger trg_notify_admin_menu_change after insert or update on public.menu_prices for each row execute function public.notify_admin_menu_change();

notify pgrst,'reload schema';
