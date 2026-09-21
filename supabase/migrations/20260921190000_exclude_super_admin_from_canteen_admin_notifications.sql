-- Exclude Super Admin accounts from ordinary canteen-admin notification fan-out.
-- Super Admin remains an admin-role profile for authentication/platform access, but
-- must not be treated as a normal canteen Admin recipient for tenant operational alerts.
-- Legitimate platform-level Super Admin notifications use their dedicated routing path.

create or replace function private.create_admin_notification(
  p_canteen_id uuid,
  p_permission text,
  p_notification_type text,
  p_title text,
  p_message text,
  p_payload jsonb default '{}'::jsonb,
  p_event_key text default null
)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_payload jsonb := coalesce(p_payload,'{}'::jsonb);
  v_count integer := 0;
begin
  if p_canteen_id is null then return 0; end if;

  if p_event_key is not null and length(trim(p_event_key)) > 0 then
    v_payload := v_payload || jsonb_build_object('event_key',p_event_key);
  end if;

  insert into public.notifications(
    recipient_id,notification_type,title,message,payload,created_at,canteen_id
  )
  select
    p.id,p_notification_type,p_title,p_message,v_payload,now(),p_canteen_id
  from public.profiles p
  where p.role='admin'
    and p.admin_role <> 'super_admin'
    and p.status='active'
    and p.canteen_id=p_canteen_id
    and (
      p.admin_role in ('owner','master_admin')
      or (p_permission is not null and exists(
        select 1
        from public.admin_permissions ap
        where ap.admin_id=p.id
          and ap.canteen_id=p_canteen_id
          and ap.permission=p_permission
          and ap.enabled
      ))
    )
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function private.create_admin_notification(uuid,text,text,text,text,jsonb,text) from public,anon,authenticated;
notify pgrst,'reload schema';
