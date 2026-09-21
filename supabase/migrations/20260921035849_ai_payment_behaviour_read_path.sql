-- Secure read-only source for Admin AI Payment Behaviour.
create or replace function public.get_ai_payment_behaviour_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_canteen_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select p.canteen_id into v_canteen_id
  from public.profiles p
  where p.id = v_uid and p.role = 'admin' and p.status = 'active' and p.canteen_id is not null
  limit 1;

  if v_canteen_id is null then
    raise exception 'Active admin canteen could not be determined';
  end if;

  if not (public.is_super_admin() or public.has_admin_permission('payments')) then
    raise exception 'Payment administration permission required';
  end if;

  return jsonb_build_object(
    'canteen_id', v_canteen_id,
    'business_date', public.gocanteen_business_timestamp(),
    'bills',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', b.id,
            'employee_id', b.employee_id,
            'bill_month', b.bill_month,
            'bill_year', b.bill_year,
            'total', b.total,
            'published', b.published,
            'published_at', b.published_at,
            'member_name_snapshot', b.member_name_snapshot,
            'payments', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', p.id,
                  'bill_id', p.bill_id,
                  'employee_id', p.employee_id,
                  'amount', p.amount,
                  'status', p.status,
                  'confirmed_at', p.confirmed_at,
                  'approved_at', p.approved_at,
                  'created_at', p.created_at,
                  'updated_at', p.updated_at,
                  'request_sequence', p.request_sequence
                )
                order by p.request_sequence nulls last, p.created_at asc, p.id asc
              )
              from public.bill_payments p
              where p.bill_id = b.id and p.canteen_id = v_canteen_id
            ), '[]'::jsonb),
            'reminders', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', r.id,
                  'bill_id', r.bill_id,
                  'payment_id', r.payment_id,
                  'employee_id', r.employee_id,
                  'sent_at', r.sent_at
                )
                order by r.sent_at asc, r.id asc
              )
              from public.payment_reminders r
              where r.bill_id = b.id and r.canteen_id = v_canteen_id
            ), '[]'::jsonb)
          )
          order by b.bill_year asc, b.bill_month asc, b.published_at asc, b.id asc
        )
        from public.monthly_bills b
        where b.canteen_id = v_canteen_id and b.published = true and b.published_at is not null
      ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.get_ai_payment_behaviour_data() from public;
revoke execute on function public.get_ai_payment_behaviour_data() from anon;
grant execute on function public.get_ai_payment_behaviour_data() to authenticated;

comment on function public.get_ai_payment_behaviour_data() is
'Read-only, tenant-scoped source for Admin AI Payment Behaviour. Uses existing payment authorization; returns only published bill, payment-history, reminder, and timing-source fields.';
