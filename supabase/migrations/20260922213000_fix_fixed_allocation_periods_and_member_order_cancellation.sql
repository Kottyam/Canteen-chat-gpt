create or replace function private.fixed_allocation_total(
  p_employee_id uuid,
  p_canteen_id uuid,
  p_month_start date,
  p_as_of timestamp with time zone
)
returns table(total_allocated numeric, first_allocation_at timestamp with time zone, has_allocation boolean)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_allocation record;
  v_mode text;
  v_fixed numeric;
  v_updated_at timestamptz;
  v_virtual_at timestamptz;
  v_current_month date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select a.id, a.allocation_amount, a.effective_at
    into v_allocation
    from private.employee_food_fixed_allocations a
   where a.employee_id=p_employee_id
     and a.canteen_id=p_canteen_id
     and a.calendar_month=p_month_start
     and a.effective_at<=p_as_of
   order by a.effective_at desc, a.created_at desc, a.id desc
   limit 1;

  if found then
    return query
      select round(greatest(coalesce(v_allocation.allocation_amount,0),0),2),
             v_allocation.effective_at,
             true;
    return;
  end if;

  if p_month_start>=date_trunc('month',v_current_month)::date then
    select
      coalesce(s.contribution_mode,g.contribution_mode,'percentage'),
      coalesce(s.fixed_monthly_amount,g.fixed_monthly_amount,0),
      coalesce(s.updated_at,g.updated_at)
      into v_mode,v_fixed,v_updated_at
      from public.profiles p
      left join public.employee_food_arrangement_settings s
        on s.canteen_id=p.canteen_id and s.employee_id=p.id
      left join public.employee_food_arrangement_settings g
        on g.canteen_id=p.canteen_id and g.employee_id is null
     where p.id=p_employee_id
       and p.role='employee'
       and p.status<>'deleted'
       and p.canteen_id=p_canteen_id;

    if v_mode='fixed_amount' and greatest(0,coalesce(v_fixed,0))>0 then
      v_virtual_at:=greatest(
        make_timestamptz(
          extract(year from p_month_start)::int,
          extract(month from p_month_start)::int,
          1,0,0,0,'Asia/Kolkata'
        ),
        coalesce(
          v_updated_at,
          make_timestamptz(
            extract(year from p_month_start)::int,
            extract(month from p_month_start)::int,
            1,0,0,0,'Asia/Kolkata'
          )
        )
      );
      if v_virtual_at<=p_as_of then
        return query select round(v_fixed,2),v_virtual_at,true;
        return;
      end if;
    end if;
  end if;

  return query select 0::numeric,null::timestamptz,false;
end;
$function$;

create or replace function private.fixed_contribution_state(
  p_employee_id uuid,
  p_canteen_id uuid,
  p_month_start date,
  p_as_of timestamp with time zone
)
returns table(total_allocated numeric, consumed numeric, available numeric, has_allocation boolean)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_total numeric:=0;
  v_first timestamptz;
  v_has boolean:=false;
  v_next timestamptz;
  v_consumed numeric:=0;
  r record;
begin
  select a.total_allocated,a.first_allocation_at,a.has_allocation
    into v_total,v_first,v_has
    from private.fixed_allocation_total(
      p_employee_id,p_canteen_id,p_month_start,p_as_of
    ) a;

  if not v_has then
    return query select 0::numeric,0::numeric,0::numeric,false;
    return;
  end if;

  select min(a.effective_at)
    into v_next
    from private.employee_food_fixed_allocations a
   where a.employee_id=p_employee_id
     and a.canteen_id=p_canteen_id
     and a.calendar_month=p_month_start
     and a.effective_at>v_first;

  for r in
    with tx as (
      select
        o.created_at tx_time,
        coalesce(sum(
          case
            when oi.item_source<>'guest'
              then greatest(coalesce(oi.line_total,oi.quantity*oi.unit_price),0)
            else 0
          end
        ),0) gross_amount
      from public.orders o
      left join public.order_items oi on oi.order_id=o.id
      where o.employee_id=p_employee_id
        and o.canteen_id=p_canteen_id
        and o.status='active'
        and o.ordered_for>=p_month_start
        and o.ordered_for<(p_month_start+interval '1 month')::date
        and o.created_at<p_as_of
        and o.employee_contribution_mode='fixed_amount'
        and o.created_at>=v_first
        and (v_next is null or o.created_at<v_next)
      group by o.id,o.created_at

      union all

      select
        a.created_at,
        greatest(coalesce(a.amount,0),0)
      from public.employee_adjustments a
      where a.employee_id=p_employee_id
        and a.canteen_id=p_canteen_id
        and a.contribution_eligible
        and a.adjustment_date>=p_month_start
        and a.adjustment_date<(p_month_start+interval '1 month')::date
        and a.created_at<p_as_of
        and a.contribution_mode='fixed_amount'
        and a.created_at>=v_first
        and (v_next is null or a.created_at<v_next)
    )
    select * from tx order by tx_time
  loop
    v_consumed:=v_consumed+greatest(coalesce(r.gross_amount,0),0);
  end loop;

  return query
    select
      round(v_total,2),
      round(v_consumed,2),
      greatest(0,round(v_total-v_consumed,2)),
      true;
end;
$function$;

create or replace function public.cancel_order_source(
  p_order_id uuid,
  p_source text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.orders%rowtype;
  v_profile public.profiles%rowtype;
  v_remaining_guest numeric:=0;
  v_remaining_items integer:=0;
  v_is_admin boolean:=false;
  v_item_source text;
  v_message text;
  v_title text;
  v_type text;
  v_event_key text;
begin
  if p_source not in ('employee','guest') then raise exception 'Invalid order source'; end if;
  select * into v_order from public.orders where id=p_order_id and status='active' for update;
  if not found then raise exception 'Active order not found'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and status='active' limit 1;
  if not found then raise exception 'Not authenticated'; end if;
  v_is_admin:=v_profile.role='admin' and v_profile.canteen_id is not null and v_profile.canteen_id=v_order.canteen_id;
  if v_is_admin then
    if not public.has_admin_permission('orders') then raise exception 'Order permission required'; end if;
  elsif v_order.employee_id<>auth.uid() then
    raise exception 'Not allowed to cancel this order'; end if;

  v_item_source:=case when v_is_admin and p_source='employee' and coalesce(v_order.order_source,'employee')='admin' then 'admin' else p_source end;

  if p_source='employee' then
    delete from public.employee_adjustments
     where order_id=p_order_id
       and canteen_id=v_order.canteen_id
       and employee_id=v_order.employee_id;
  end if;

  delete from public.order_items where order_id=p_order_id and item_source=v_item_source;
  select count(*) into v_remaining_items from public.order_items where order_id=p_order_id and coalesce(quantity,0)>0;

  if v_remaining_items=0 then
    if v_is_admin then
      v_type:='order_cancelled';
      v_title:='Order Cancelled';
      v_message:=format('Your order for %s was cancelled by Admin.',to_char(v_order.ordered_for,'DD Mon YYYY'));
      v_event_key:=format('order_cancelled:%s',v_order.id::text);
      perform public.create_member_notification(v_order.employee_id,v_type,v_title,v_message,jsonb_build_object('cancelled_order_id',v_order.id,'order_date',v_order.ordered_for::text,'order_source',v_order.order_source,'cancelled_source',p_source),v_event_key);
    end if;
    delete from public.orders where id=p_order_id;
    return;
  end if;

  select coalesce(sum(quantity*unit_price),0) into v_remaining_guest
  from public.order_items where order_id=p_order_id and item_source='guest' and coalesce(quantity,0)>0;
  update public.orders
  set guest_total=v_remaining_guest,
      guest_name=case when v_remaining_guest>0 then guest_name else null end,
      guest_count=case when v_remaining_guest>0 then guest_count else null end,
      status='active',cancelled_at=null,updated_at=now()
  where id=p_order_id;

  if v_is_admin then
    v_type:='order_part_cancelled';
    v_title:='Order Updated';
    v_message:=format('Your %s order for %s was cancelled by Admin.',case when p_source='guest' then 'guest' else 'member' end,to_char(v_order.ordered_for,'DD Mon YYYY'));
    v_event_key:=format('order_part_cancelled:%s:%s',v_order.id::text,p_source);
    perform public.create_member_notification(v_order.employee_id,v_type,v_title,v_message,jsonb_build_object('cancelled_order_id',v_order.id,'order_date',v_order.ordered_for::text,'order_source',v_order.order_source,'cancelled_source',p_source),v_event_key);
  end if;
end;
$function$;

revoke all on function private.fixed_allocation_total(uuid,uuid,date,timestamptz) from public,anon,authenticated;
revoke all on function private.fixed_contribution_state(uuid,uuid,date,timestamptz) from public,anon,authenticated;
grant execute on function public.cancel_order_source(uuid,text) to authenticated;
