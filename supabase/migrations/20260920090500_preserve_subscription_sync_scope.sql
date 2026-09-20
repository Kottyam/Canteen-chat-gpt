create or replace function private.sync_subscription_statuses_system(p_canteen_id uuid default null)
returns void language plpgsql security definer set search_path=''
as $$
declare v_sub public.canteen_subscriptions; v_next_plan_id uuid;
begin
  for v_sub in
    select * from public.canteen_subscriptions
    where (p_canteen_id is null or canteen_id=p_canteen_id)
      and ((status='trial' and trial_end is not null and trial_end<=now()) or (status='active' and subscription_end is not null and subscription_end<=now()))
    for update
  loop
    if v_sub.status='trial' then
      update public.canteen_subscriptions set status='suspended',payment_status='pending',updated_at=now() where id=v_sub.id;
    else
      if v_sub.plan_selection_mode='auto_range' then v_next_plan_id:=public.resolve_member_range_plan(v_sub.canteen_id); else v_next_plan_id:=v_sub.plan_id; end if;
      update public.canteen_subscriptions set plan_id=coalesce(v_next_plan_id,v_sub.plan_id),status='expired',payment_status='pending',updated_at=now() where id=v_sub.id;
    end if;
  end loop;
end $$;

create or replace function public.sync_subscription_statuses(p_canteen_id uuid default null)
returns void language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_allowed boolean:=false;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if public.is_super_admin() then v_allowed:=true;
  elsif p_canteen_id is not null and public.current_canteen_id()=p_canteen_id then v_allowed:=true;
  end if;
  if not v_allowed then raise exception 'Not authorized'; end if;
  perform private.sync_subscription_statuses_system(p_canteen_id);
end $$;
revoke all on function private.sync_subscription_statuses_system(uuid) from public,anon,authenticated;