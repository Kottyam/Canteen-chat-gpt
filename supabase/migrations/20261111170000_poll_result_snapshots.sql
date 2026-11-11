-- Final results snapshot for ENDED polls: computed once, then served as-is.
-- New table + one RPC. Does not modify polls or poll_responses rows.
-- Retention unchanged: the snapshot is deleted together with its poll (ON DELETE CASCADE),
-- so the existing 10-day poll auto-delete still removes everything.

create table if not exists public.poll_result_snapshots (
  poll_id uuid primary key references public.polls(id) on delete cascade,
  canteen_id uuid not null references public.canteens(id) on delete cascade,
  title text not null,
  questions jsonb not null default '[]'::jsonb,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  response_count integer not null default 0,
  responses jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table public.poll_result_snapshots enable row level security;

-- Admins of the canteen may read; nobody writes directly (only the SECURITY DEFINER RPC below).
drop policy if exists poll_result_snapshots_admin_select on public.poll_result_snapshots;
create policy poll_result_snapshots_admin_select on public.poll_result_snapshots
  for select to authenticated
  using (canteen_id = public.current_canteen_id() and public.is_admin_user());

revoke insert, update, delete on public.poll_result_snapshots from anon, authenticated;

create or replace function public.admin_poll_result_snapshot(p_poll_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_poll public.polls%rowtype;
  v_snap public.poll_result_snapshots%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_admin_user() then raise exception 'Admin authorization required'; end if;
  select * into v_poll from public.polls where id = p_poll_id;
  if not found or v_poll.canteen_id is distinct from public.current_canteen_id() then
    raise exception 'Poll not found';
  end if;
  if not (public.has_admin_permission('payments') or public.has_admin_permission('menu')) then
    raise exception 'Poll permission required';
  end if;
  if v_poll.ends_at > now() then
    raise exception 'Poll has not ended yet';
  end if;

  select * into v_snap from public.poll_result_snapshots where poll_id = p_poll_id;
  if not found then
    insert into public.poll_result_snapshots (poll_id, canteen_id, title, questions, starts_at, ends_at, response_count, responses, created_by)
    select v_poll.id, v_poll.canteen_id, coalesce(v_poll.title, 'Poll'), coalesce(v_poll.questions, '[]'::jsonb),
           v_poll.starts_at, v_poll.ends_at, count(r.id),
           coalesce(jsonb_agg(jsonb_build_object(
             'memberId', r.member_id,
             'memberName', coalesce(nullif(r.member_name, ''), r.member_id),
             'answers', coalesce(r.answers, '{}'::jsonb),
             'submittedAt', r.submitted_at) order by r.submitted_at) filter (where r.id is not null), '[]'::jsonb),
           auth.uid()
      from (select 1) one
      left join public.poll_responses r on r.poll_id = v_poll.id
    on conflict (poll_id) do nothing;
    select * into v_snap from public.poll_result_snapshots where poll_id = p_poll_id;
  end if;

  return jsonb_build_object(
    'pollId', v_snap.poll_id, 'title', v_snap.title, 'questions', v_snap.questions,
    'startsAt', v_snap.starts_at, 'endsAt', v_snap.ends_at,
    'responseCount', v_snap.response_count, 'responses', v_snap.responses,
    'snapshotAt', v_snap.created_at);
end
$function$;

revoke all on function public.admin_poll_result_snapshot(uuid) from public, anon;
grant execute on function public.admin_poll_result_snapshot(uuid) to authenticated;
