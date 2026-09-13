-- Restore the intended client execution privilege for the existing,
-- SECURITY DEFINER notification RPC used by authorized admin notification flows.
-- The function itself retains its existing admin, recipient, and tenant checks.
revoke execute on function public.create_member_notification(uuid, text, text, text, jsonb, text) from public, anon;
grant execute on function public.create_member_notification(uuid, text, text, text, jsonb, text) to authenticated;
notify pgrst, 'reload schema';
