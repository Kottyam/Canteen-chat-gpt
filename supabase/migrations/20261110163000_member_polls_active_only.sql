-- Members may only read currently active (enabled + inside the start/end window) polls.
-- Admins keep full canteen access, including ended poll history and results.
-- Additive: no poll or response rows are deleted.

drop policy if exists polls_select on public.polls;
create policy polls_select on public.polls
  for select to authenticated
  using (
    canteen_id in (select p.canteen_id from public.profiles p where p.id = auth.uid())
    and enabled = true
    and starts_at <= now()
    and ends_at >= now()
  );

-- polls_admin_all (FOR ALL) remains: admins still SELECT/INSERT/UPDATE/DELETE every poll in their canteen.

drop policy if exists poll_responses_select on public.poll_responses;
create policy poll_responses_select on public.poll_responses
  for select to authenticated
  using (
    canteen_id in (select p.canteen_id from public.profiles p where p.id = auth.uid())
    and (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'admin' and p.canteen_id = poll_responses.canteen_id
      )
      or (
        (
          member_id = (select coalesce(employee_code, id::text) from public.profiles where id = auth.uid())
          or member_id = auth.uid()::text
        )
        and exists (
          select 1 from public.polls pl
          where pl.id = poll_responses.poll_id
            and pl.enabled = true
            and pl.starts_at <= now()
            and pl.ends_at >= now()
        )
      )
    )
  );

-- Production currently uses poll_responses_insert / poll_responses_update;
-- the repo's first poll migration used *_member_upsert / *_member_update. Drop both.
drop policy if exists poll_responses_insert on public.poll_responses;
drop policy if exists poll_responses_update on public.poll_responses;
drop policy if exists poll_responses_member_upsert on public.poll_responses;
create policy poll_responses_member_upsert on public.poll_responses
  for insert to authenticated
  with check (
    canteen_id in (select p.canteen_id from public.profiles p where p.id = auth.uid())
    and exists (
      select 1 from public.polls pl
      where pl.id = poll_id
        and pl.enabled = true
        and pl.starts_at <= now()
        and pl.ends_at >= now()
    )
  );

drop policy if exists poll_responses_member_update on public.poll_responses;
create policy poll_responses_member_update on public.poll_responses
  for update to authenticated
  using (
    canteen_id in (select p.canteen_id from public.profiles p where p.id = auth.uid())
    and (
      member_id = (select coalesce(employee_code, id::text) from public.profiles where id = auth.uid())
      or member_id = auth.uid()::text
    )
    and exists (
      select 1 from public.polls pl
      where pl.id = poll_responses.poll_id
        and pl.enabled = true
        and pl.starts_at <= now()
        and pl.ends_at >= now()
    )
  )
  with check (
    canteen_id in (select p.canteen_id from public.profiles p where p.id = auth.uid())
  );
