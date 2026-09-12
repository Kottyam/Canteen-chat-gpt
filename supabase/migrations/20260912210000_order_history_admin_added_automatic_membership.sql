-- Admin Member/Staff additional amounts are inherently part of the selected
-- date's Order History. Delete them with the date's history, whether or not
-- an existing food order supplied an order_id.

drop function if exists public.admin_delete_order_history_for_date(date);
create function public.admin_delete_order_history_for_date(p_date date)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_canteen uuid:=public.current_canteen_id();
  v_order_ids uuid[]:='{}'::uuid[];
  v_adjustment_ids uuid[]:='{}'::uuid[];
  v_deleted_orders integer:=0;
  v_deleted_items integer:=0;
  v_deleted_adjustments integer:=0;
  v_deleted_notifications integer:=0;
  v_deleted_order_amount numeric:=0;
  v_deleted_guest_amount numeric:=0;
  v_deleted_admin_amount numeric:=0;
  r record;
  v_days integer;
begin
  if not public.is_google_owner() then raise exception 'Owner authorization required'; end if;
  if v_canteen is null then raise exception 'Canteen context required'; end if;
  if p_date is null then raise exception 'Order history date is required'; end if;

  select coalesce(array_agg(o.id),'{}'::uuid[]) into v_order_ids from public.orders o where o.canteen_id=v_canteen and o.ordered_for=p_date;
  select coalesce(array_agg(a.id),'{}'::uuid[]) into v_adjustment_ids from public.employee_adjustments a where a.canteen_id=v_canteen and a.adjustment_date=p_date;

  create temporary table if not exists _gocanteen_history_impact(employee_id uuid primary key,bill_month integer,bill_year integer,food_total numeric not null default 0,guest_total numeric not null default 0,admin_total numeric not null default 0) on commit drop;
  truncate _gocanteen_history_impact;

  insert into _gocanteen_history_impact(employee_id,bill_month,bill_year,food_total,guest_total,admin_total)
  select o.employee_id,extract(month from o.ordered_for)::integer,extract(year from o.ordered_for)::integer,
    coalesce(sum(case when oi.item_source<>'guest' then greatest(coalesce(oi.line_total,oi.quantity*oi.unit_price),0) else 0 end),0),
    coalesce(sum(case when oi.item_source='guest' then greatest(coalesce(oi.line_total,oi.quantity*oi.unit_price),0) else 0 end),0),0
  from public.orders o left join public.order_items oi on oi.order_id=o.id
  where o.canteen_id=v_canteen and o.ordered_for=p_date group by o.employee_id,o.ordered_for;

  if coalesce(array_length(v_adjustment_ids,1),0)>0 then
    insert into _gocanteen_history_impact(employee_id,bill_month,bill_year,food_total,guest_total,admin_total)
    select a.employee_id,extract(month from a.adjustment_date)::integer,extract(year from a.adjustment_date)::integer,0,0,coalesce(sum(greatest(coalesce(a.amount,0),0)),0)
    from public.employee_adjustments a where a.canteen_id=v_canteen and a.id=any(v_adjustment_ids)
    group by a.employee_id,a.adjustment_date
    on conflict(employee_id) do update set admin_total=_gocanteen_history_impact.admin_total+excluded.admin_total;
  end if;

  select coalesce(sum(case when oi.item_source<>'guest' then greatest(coalesce(oi.line_total,oi.quantity*oi.unit_price),0) else 0 end),0),coalesce(sum(case when oi.item_source='guest' then greatest(coalesce(oi.line_total,oi.quantity*oi.unit_price),0) else 0 end),0)
  into v_deleted_order_amount,v_deleted_guest_amount from public.order_items oi
  where coalesce(array_length(v_order_ids,1),0)>0 and oi.order_id=any(v_order_ids) and oi.canteen_id=v_canteen;

  if coalesce(array_length(v_adjustment_ids,1),0)>0 then
    select coalesce(sum(greatest(coalesce(a.amount,0),0)),0) into v_deleted_admin_amount from public.employee_adjustments a where a.id=any(v_adjustment_ids) and a.canteen_id=v_canteen;
  end if;

  if coalesce(array_length(v_order_ids,1),0)>0 or coalesce(array_length(v_adjustment_ids,1),0)>0 then
    delete from public.notifications n where n.canteen_id=v_canteen and ((n.payload ? 'order_id' and (n.payload->>'order_id')::uuid=any(v_order_ids)) or (n.payload ? 'adjustment_id' and (n.payload->>'adjustment_id')::uuid=any(v_adjustment_ids)));
    get diagnostics v_deleted_notifications=row_count;
  end if;

  if coalesce(array_length(v_adjustment_ids,1),0)>0 then
    delete from public.employee_adjustments where id=any(v_adjustment_ids) and canteen_id=v_canteen;
    get diagnostics v_deleted_adjustments=row_count;
  end if;

  if coalesce(array_length(v_order_ids,1),0)>0 then
    delete from public.order_items where order_id=any(v_order_ids) and canteen_id=v_canteen;
    get diagnostics v_deleted_items=row_count;
    delete from public.orders where id=any(v_order_ids) and canteen_id=v_canteen and ordered_for=p_date;
    get diagnostics v_deleted_orders=row_count;
  end if;

  for r in select * from _gocanteen_history_impact loop
    select count(distinct o.ordered_for)::integer into v_days from public.orders o where o.employee_id=r.employee_id and o.canteen_id=v_canteen and extract(month from o.ordered_for)=r.bill_month and extract(year from o.ordered_for)=r.bill_year and coalesce(o.status,'')<>'cancelled';
    update public.monthly_bills mb set food_total=greatest(coalesce(mb.food_total,0)-coalesce(r.food_total,0),0),guest_food_total=greatest(coalesce(mb.guest_food_total,0)-coalesce(r.guest_total,0),0),admin_added_total=greatest(coalesce(mb.admin_added_total,0)-coalesce(r.admin_total,0),0),total=greatest(coalesce(mb.food_total,0)-coalesce(r.food_total,0),0)+greatest(coalesce(mb.admin_added_total,0)-coalesce(r.admin_total,0),0),days_ordered=coalesce(v_days,0),updated_at=now() where mb.employee_id=r.employee_id and mb.canteen_id=v_canteen and mb.bill_month=r.bill_month and mb.bill_year=r.bill_year and mb.published=false;
  end loop;

  return jsonb_build_object('date',p_date,'deleted_orders',v_deleted_orders,'deleted_order_items',v_deleted_items,'deleted_admin_added_adjustments',v_deleted_adjustments,'deleted_notifications',v_deleted_notifications,'deleted_member_food_amount',v_deleted_order_amount,'deleted_guest_food_amount',v_deleted_guest_amount,'deleted_admin_added_amount',v_deleted_admin_amount);
end;
$$;
revoke all on function public.admin_delete_order_history_for_date(date) from public;
grant execute on function public.admin_delete_order_history_for_date(date) to authenticated;
notify pgrst,'reload schema';