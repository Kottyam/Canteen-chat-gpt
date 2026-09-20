create schema if not exists private;

create or replace function private.create_super_admin_subscription_notification(p_canteen_id uuid,p_notification_type text,p_title text,p_message text,p_payload jsonb default '{}'::jsonb,p_event_key text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare v_payload jsonb:=coalesce(p_payload,'{}'::jsonb); v_count integer:=0;
begin
 if p_event_key is not null and length(trim(p_event_key))>0 then v_payload:=v_payload||jsonb_build_object('event_key',p_event_key); end if;
 insert into public.notifications(recipient_id,notification_type,title,message,payload,created_at,canteen_id)
 select p.id,p_notification_type,p_title,p_message,v_payload,now(),p_canteen_id from public.profiles p where p.role='admin' and p.admin_role='super_admin' and p.status='active' on conflict do nothing;
 get diagnostics v_count=row_count; return v_count;
end $$;
revoke all on function private.create_super_admin_subscription_notification(uuid,text,text,text,jsonb,text) from public,anon,authenticated;

create or replace function private.create_canteen_subscription_notification(p_canteen_id uuid,p_notification_type text,p_title text,p_message text,p_payload jsonb default '{}'::jsonb,p_event_key text default null)
returns integer language plpgsql security definer set search_path='' as $$ begin return private.create_admin_notification(p_canteen_id,'payments',p_notification_type,p_title,p_message,p_payload,p_event_key); end $$;
revoke all on function private.create_canteen_subscription_notification(uuid,text,text,text,jsonb,text) from public,anon,authenticated;

create or replace function private.sync_subscription_statuses_system()
returns void language plpgsql security definer set search_path='' as $$
declare v_sub public.canteen_subscriptions; v_next_plan_id uuid;
begin
 for v_sub in select * from public.canteen_subscriptions where (status='trial' and trial_end is not null and trial_end<=now()) or (status='active' and subscription_end is not null and subscription_end<=now()) for update loop
  if v_sub.status='trial' then update public.canteen_subscriptions set status='suspended',payment_status='pending',updated_at=now() where id=v_sub.id;
  else
   if v_sub.plan_selection_mode='auto_range' then v_next_plan_id:=public.resolve_member_range_plan(v_sub.canteen_id); else v_next_plan_id:=v_sub.plan_id; end if;
   update public.canteen_subscriptions set plan_id=coalesce(v_next_plan_id,v_sub.plan_id),status='expired',payment_status='pending',updated_at=now() where id=v_sub.id;
  end if;
 end loop;
end $$;
revoke all on function private.sync_subscription_statuses_system() from public,anon,authenticated;

create or replace function public.sync_subscription_statuses(p_canteen_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_allowed boolean:=false;
begin
 if v_uid is null then raise exception 'Authentication required'; end if;
 if public.is_super_admin() then v_allowed:=true; elsif p_canteen_id is not null and public.current_canteen_id()=p_canteen_id then v_allowed:=true; end if;
 if not v_allowed then raise exception 'Not authorized'; end if;
 perform private.sync_subscription_statuses_system();
end $$;

create or replace function public.notify_new_canteen_created()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.create_super_admin_subscription_notification(new.id,'new_canteen_created','New Canteen Created',format('%s has been created by a new administrator.',coalesce(new.name,'New Canteen')),jsonb_build_object('screen','canteens','canteen_id',new.id,'canteen_name',new.name,'owner_id',new.owner_id),format('new_canteen_created:%s',new.id));
 return new;
end $$;
drop trigger if exists trg_notify_new_canteen_created on public.canteens;
create trigger trg_notify_new_canteen_created after insert on public.canteens for each row execute function public.notify_new_canteen_created();
revoke all on function public.notify_new_canteen_created() from public,anon,authenticated;

create or replace function public.notify_subscription_payment_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_canteen_name text; v_valid_until text; v_key text;
begin
 select c.name into v_canteen_name from public.canteens c where c.id=new.canteen_id; v_canteen_name:=coalesce(v_canteen_name,'Canteen');
 if tg_op='INSERT' and new.payment_status='pending' then
  v_key:=format('subscription_payment_submitted:%s',new.id);
  perform private.create_super_admin_subscription_notification(new.canteen_id,'subscription_payment_submitted','Payment Submitted',format('%s has submitted a subscription payment of %s. Payment is awaiting confirmation.',v_canteen_name,to_char(new.amount,'FM999999990.00')||' '||coalesce(new.currency,'INR')),jsonb_build_object('screen','payment_review','payment_id',new.id,'subscription_id',new.subscription_id,'amount',new.amount,'currency',new.currency,'payment_type',new.payment_type),v_key);
  perform private.create_canteen_subscription_notification(new.canteen_id,'subscription_payment_submitted','Payment Submitted','Your subscription payment has been submitted and is awaiting administrator confirmation.',jsonb_build_object('screen','billing_subscription','payment_id',new.id,'subscription_id',new.subscription_id,'amount',new.amount,'currency',new.currency),v_key);
 elsif tg_op='UPDATE' and old.payment_status is distinct from new.payment_status and new.payment_status in ('paid','failed') then
  if new.payment_status='paid' then
   v_valid_until:=to_char(new.billing_period_end at time zone 'Asia/Kolkata','DD Mon YYYY');
   perform private.create_super_admin_subscription_notification(new.canteen_id,'subscription_payment_confirmed','Payment Confirmed',format('Subscription payment for %s has been confirmed.',v_canteen_name),jsonb_build_object('screen','payment_review','payment_id',new.id,'subscription_id',new.subscription_id,'billing_period_end',new.billing_period_end,'payment_type',new.payment_type),format('subscription_payment_confirmed:%s',new.id));
   perform private.create_canteen_subscription_notification(new.canteen_id,'subscription_payment_confirmed','Payment Confirmed',format('Your subscription payment has been confirmed. Your subscription is valid until %s.',coalesce(v_valid_until,'the configured end date')),jsonb_build_object('screen','billing_subscription','payment_id',new.id,'subscription_id',new.subscription_id,'billing_period_end',new.billing_period_end,'payment_type',new.payment_type),format('subscription_payment_confirmed:%s',new.id));
   if new.payment_type='renewal' then
    perform private.create_canteen_subscription_notification(new.canteen_id,'subscription_renewed','Subscription Renewed',format('Your GoCanteen subscription has been renewed successfully. Your new subscription is valid until %s.',coalesce(v_valid_until,'the configured end date')),jsonb_build_object('screen','billing_subscription','payment_id',new.id,'subscription_id',new.subscription_id,'billing_period_end',new.billing_period_end),format('subscription_renewed:%s',new.id));
    perform private.create_super_admin_subscription_notification(new.canteen_id,'subscription_renewed','Subscription Renewed',format('%s subscription has been renewed successfully.',v_canteen_name),jsonb_build_object('screen','payment_review','payment_id',new.id,'subscription_id',new.subscription_id,'billing_period_end',new.billing_period_end),format('subscription_renewed:%s',new.id));
   end if;
  else
   perform private.create_super_admin_subscription_notification(new.canteen_id,'subscription_payment_not_received','Payment Not Received',format('The submitted payment for %s could not be confirmed.',v_canteen_name),jsonb_build_object('screen','payment_review','payment_id',new.id,'subscription_id',new.subscription_id),format('subscription_payment_not_received:%s',new.id));
   perform private.create_canteen_subscription_notification(new.canteen_id,'subscription_payment_not_received','Payment Not Received','Your submitted payment could not be confirmed. Please check the payment details and submit again if required.',jsonb_build_object('screen','billing_subscription','payment_id',new.id,'subscription_id',new.subscription_id),format('subscription_payment_not_received:%s',new.id));
  end if;
 end if;
 return new;
end $$;
drop trigger if exists trg_notify_subscription_payment_event on public.subscription_payments;
create trigger trg_notify_subscription_payment_event after insert or update on public.subscription_payments for each row execute function public.notify_subscription_payment_event();
revoke all on function public.notify_subscription_payment_event() from public,anon,authenticated;

create or replace function public.notify_subscription_lifecycle_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_name text; v_end text;
begin
 select c.name into v_name from public.canteens c where c.id=new.canteen_id; v_name:=coalesce(v_name,'Canteen');
 if (tg_op='INSERT' and new.status='trial') or (tg_op='UPDATE' and new.status='trial' and old.status is distinct from new.status) then
  v_end:=to_char(new.trial_end at time zone 'Asia/Kolkata','DD Mon YYYY');
  perform private.create_canteen_subscription_notification(new.canteen_id,'trial_started','Trial Started',format('Your GoCanteen trial has started. Your trial is active until %s.',v_end),jsonb_build_object('screen','billing_subscription','subscription_id',new.id,'trial_end',new.trial_end),format('trial_started:%s:%s',new.id,new.trial_end::text));
 end if;
 if tg_op='UPDATE' and old.status is distinct from new.status then
  if new.status='expired' then
   perform private.create_super_admin_subscription_notification(new.canteen_id,'subscription_expired','Subscription Expired',format('%s subscription has expired and is now restricted.',v_name),jsonb_build_object('screen','payment_review','subscription_id',new.id,'subscription_end',new.subscription_end),format('subscription_expired:%s:%s',new.id,coalesce(new.subscription_end,old.subscription_end)::text));
   perform private.create_canteen_subscription_notification(new.canteen_id,'subscription_expired','Subscription Expired','Your subscription has expired. Please complete payment to continue using GoCanteen.',jsonb_build_object('screen','billing_subscription','subscription_id',new.id,'subscription_end',new.subscription_end),format('subscription_expired:%s:%s',new.id,coalesce(new.subscription_end,old.subscription_end)::text));
   perform private.create_canteen_subscription_notification(new.canteen_id,'access_restricted','Access Restricted','Your canteen access has been restricted because your subscription has expired. Please complete the payment to restore access.',jsonb_build_object('screen','billing_subscription','subscription_id',new.id,'subscription_end',new.subscription_end),format('access_restricted:%s:%s',new.id,coalesce(new.subscription_end,old.subscription_end)::text));
  elsif new.status='suspended' then
   if old.status='trial' then
    perform private.create_super_admin_subscription_notification(new.canteen_id,'trial_expired','Trial Expired',format('%s trial has expired and access is now suspended.',v_name),jsonb_build_object('screen','payment_review','subscription_id',new.id,'trial_end',old.trial_end),format('trial_expired:%s:%s',new.id,coalesce(old.trial_end,new.trial_end)::text));
    perform private.create_canteen_subscription_notification(new.canteen_id,'trial_expired','Trial Expired','Your trial has expired. Please complete your subscription payment to continue using GoCanteen.',jsonb_build_object('screen','billing_subscription','subscription_id',new.id,'trial_end',old.trial_end),format('trial_expired:%s:%s',new.id,coalesce(old.trial_end,new.trial_end)::text));
   else
    perform private.create_super_admin_subscription_notification(new.canteen_id,'subscription_suspended','Subscription Suspended',format('%s subscription has been suspended because payment is not confirmed.',v_name),jsonb_build_object('screen','payment_review','subscription_id',new.id),format('subscription_suspended:%s:%s',new.id,new.updated_at::text));
    perform private.create_canteen_subscription_notification(new.canteen_id,'subscription_suspended','Subscription Suspended','Your subscription has been suspended because the required payment has not been confirmed.',jsonb_build_object('screen','billing_subscription','subscription_id',new.id),format('subscription_suspended:%s:%s',new.id,new.updated_at::text));
   end if;
   perform private.create_canteen_subscription_notification(new.canteen_id,'access_restricted','Access Restricted','Your canteen access has been restricted. Please complete the required payment to restore access.',jsonb_build_object('screen','billing_subscription','subscription_id',new.id),format('access_restricted:%s:%s',new.id,new.updated_at::text));
  end if;
 end if;
 return new;
end $$;
drop trigger if exists trg_notify_subscription_lifecycle_event on public.canteen_subscriptions;
create trigger trg_notify_subscription_lifecycle_event after insert or update of status,trial_start,trial_end,subscription_start,subscription_end on public.canteen_subscriptions for each row execute function public.notify_subscription_lifecycle_event();
revoke all on function public.notify_subscription_lifecycle_event() from public,anon,authenticated;

create or replace function private.subscription_notification_scheduler()
returns void language plpgsql security definer set search_path='' as $$
declare v_today date:=(now() at time zone 'Asia/Kolkata')::date; r record; v_days integer; v_end timestamptz; v_event_key text;
begin
 perform private.sync_subscription_statuses_system();
 for r in select s.id,s.canteen_id,s.status,s.trial_end,s.subscription_end from public.canteen_subscriptions s where s.status in ('trial','active') loop
  if r.status='trial' then
   v_end:=r.trial_end; v_days:=((v_end at time zone 'Asia/Kolkata')::date-v_today);
   if v_days in (7,3,1) then
    v_event_key:=format('trial_expiring:%s:%s:%s',r.id,v_end::text,v_days);
    perform private.create_super_admin_subscription_notification(r.canteen_id,'trial_expiring','Trial Expiring',format('A canteen trial ends in %s day%s.',v_days,case when v_days=1 then '' else 's' end),jsonb_build_object('screen','payment_review','subscription_id',r.id,'trial_end',v_end,'days_remaining',v_days),v_event_key);
    perform private.create_canteen_subscription_notification(r.canteen_id,'trial_expiring','Trial Expiring',format('Your trial ends in %s day%s. Please complete your subscription payment to continue using GoCanteen.',v_days,case when v_days=1 then '' else 's' end),jsonb_build_object('screen','billing_subscription','subscription_id',r.id,'trial_end',v_end,'days_remaining',v_days),v_event_key);
   end if;
  else
   v_end:=r.subscription_end; v_days:=((v_end at time zone 'Asia/Kolkata')::date-v_today);
   if v_days in (7,3,1) then
    v_event_key:=format('subscription_expiring:%s:%s:%s',r.id,v_end::text,v_days);
    perform private.create_super_admin_subscription_notification(r.canteen_id,'subscription_expiring','Subscription Expiring',format('%s subscription expires in %s day%s.',coalesce((select c.name from public.canteens c where c.id=r.canteen_id),'Canteen'),v_days,case when v_days=1 then '' else 's' end),jsonb_build_object('screen','payment_review','subscription_id',r.id,'subscription_end',v_end,'days_remaining',v_days),v_event_key);
    perform private.create_canteen_subscription_notification(r.canteen_id,'subscription_expiring','Subscription Expiring',format('Your subscription expires in %s day%s. Please complete renewal payment to continue using GoCanteen.',v_days,case when v_days=1 then '' else 's' end),jsonb_build_object('screen','billing_subscription','subscription_id',r.id,'subscription_end',v_end,'days_remaining',v_days),v_event_key);
   end if;
  end if;
 end loop;
end $$;
revoke all on function private.subscription_notification_scheduler() from public,anon,authenticated;
do $$ begin if exists(select 1 from cron.job where jobname='gocanteen-subscription-notification-scheduler') then perform cron.unschedule('gocanteen-subscription-notification-scheduler'); end if; perform cron.schedule('gocanteen-subscription-notification-scheduler','* * * * *','select private.subscription_notification_scheduler();'); end $$;

drop policy if exists notifications_super_admin_select on public.notifications;
create policy notifications_super_admin_select on public.notifications for select to authenticated using (recipient_id=(select auth.uid()) and public.is_super_admin());
drop policy if exists notifications_super_admin_update on public.notifications;
create policy notifications_super_admin_update on public.notifications for update to authenticated using (recipient_id=(select auth.uid()) and public.is_super_admin()) with check (recipient_id=(select auth.uid()) and public.is_super_admin());
notify pgrst,'reload schema';