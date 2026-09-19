revoke execute on function public.ensure_google_admin() from public, anon;
grant execute on function public.ensure_google_admin() to authenticated;

revoke execute on function public.complete_google_admin_onboarding(text) from public, anon;
grant execute on function public.complete_google_admin_onboarding(text) to authenticated;