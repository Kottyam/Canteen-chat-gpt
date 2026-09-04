create or replace function public.admin_delete_bill_history_for_date(p_date date)
returns table(deleted_bills integer, deleted_payments integer, deleted_notifications integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canteen uuid := public.current_canteen_id();
  v_bill_ids uuid[];
  v_payment_ids uuid[];
  v_bills integer := 0;
  v_payments integer := 0;
  v_notifications integer := 0;
begin
  if p_date is null then
    raise exception 'A bill history date is required';
  end if;
  if v_canteen is null or not public.is_admin_user() then
    raise exception 'Only an authorized admin can delete bill history';
  end if;

  perform pg_advisory_xact_lock(hashtext(format('gocanteen-delete-bill-history:%s:%s', v_canteen, p_date)));

  select coalesce(array_agg(b.id), '{}'::uuid[])
    into v_bill_ids
  from public.monthly_bills b
  where b.canteen_id = v_canteen
    and b.published = true
    and (
      (b.billing_start_date is not null and b.billing_end_date is not null and p_date between b.billing_start_date and b.billing_end_date)
      or
      ((b.billing_start_date is null or b.billing_end_date is null)
       and b.bill_month = extract(month from p_date)::integer
       and b.bill_year = extract(year from p_date)::integer)
    );

  if coalesce(array_length(v_bill_ids,1),0) = 0 then
    return query select 0,0,0;
    return;
  end if;

  select coalesce(array_agg(p.id), '{}'::uuid[])
    into v_payment_ids
  from public.bill_payments p
  where p.bill_id = any(v_bill_ids)
    and p.canteen_id = v_canteen;

  if coalesce(array_length(v_payment_ids,1),0) > 0 then
    if to_regclass('public.notifications') is not null then
      delete from public.notifications n
      where n.canteen_id = v_canteen
        and (
          (n.payload ? 'payment_id' and (n.payload->>'payment_id')::text = any(select x::text from unnest(v_payment_ids) x))
          or
          (n.payload ? 'bill_id' and (n.payload->>'bill_id')::text = any(select x::text from unnest(v_bill_ids) x))
        );
      get diagnostics v_notifications = row_count;
    end if;
    delete from public.bill_payments where id = any(v_payment_ids) and canteen_id = v_canteen;
    get diagnostics v_payments = row_count;
  else
    if to_regclass('public.notifications') is not null then
      delete from public.notifications n
      where n.canteen_id = v_canteen
        and n.payload ? 'bill_id'
        and (n.payload->>'bill_id')::text = any(select x::text from unnest(v_bill_ids) x);
      get diagnostics v_notifications = row_count;
    end if;
  end if;

  delete from public.monthly_bills where id = any(v_bill_ids) and canteen_id = v_canteen;
  get diagnostics v_bills = row_count;

  return query select v_bills, v_payments, v_notifications;
end;
$$;
revoke all on function public.admin_delete_bill_history_for_date(date) from public;
grant execute on function public.admin_delete_bill_history_for_date(date) to authenticated;
