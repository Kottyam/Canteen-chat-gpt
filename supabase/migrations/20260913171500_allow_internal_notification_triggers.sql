-- Allow the existing notification RPC to serve both legitimate admin callers and
-- trusted database-generated notification paths (triggers / scheduler), while
-- keeping direct member invocation unauthorized.
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
  if not (
    public.is_admin_user()
    or session_user='postgres'
    or pg_trigger_depth()>0
  ) then
    raise exception 'Only an authorized admin can create member notifications';
  end if;

  select canteen_id into v_canteen
  from public.profiles
  where id=p_recipient_id and role='employee' and status='active';
  if v_canteen is null then return null; end if;
  if public.current_canteen_id() is distinct from v_canteen then
    if session_user<>'postgres' and pg_trigger_depth()=0 then
      raise exception 'Notification recipient is outside the current canteen';
    end if;
  end if;

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

revoke all on function public.create_member_notification(uuid,text,text,text,jsonb,text) from public;
grant execute on function public.create_member_notification(uuid,text,text,text,jsonb,text) to authenticated;
notify pgrst,'reload schema';
