-- Super Admin: read-only member list and menu for one canteen, loaded on demand.
-- SECURITY DEFINER; refuses anyone who is not an active super admin. No writes.

create or replace function public.super_admin_canteen_members(p_canteen_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
  if not exists (select 1 from public.canteens c where c.id = p_canteen_id) then raise exception 'Canteen not found'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.full_name,
      'employee_code', p.employee_code,
      'sr_number', p.sr_number,
      'mobile', p.mobile_number,
      'email', case when u.email ilike '%@gocanteen.local' then null else u.email end,
      'role', p.role,
      'admin_role', p.admin_role,
      'status', p.status,
      'joined_at', p.created_at
    ) order by (p.role = 'admin') desc, (p.status = 'active') desc, lower(coalesce(p.full_name, '')))
    from public.profiles p
    left join auth.users u on u.id = p.id
    where p.canteen_id = p_canteen_id
  ), '[]'::jsonb);
end
$function$;

create or replace function public.super_admin_canteen_menu(p_canteen_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
  if not exists (select 1 from public.canteens c where c.id = p_canteen_id) then raise exception 'Canteen not found'; end if;
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_code', m.item_code, 'item_name', m.item_name, 'unit_price', m.unit_price,
        'active', coalesce(m.active, false), 'archived', coalesce(m.archived, false),
        'category', c.name, 'updated_at', m.updated_at
      ) order by coalesce(m.archived, false), lower(coalesce(c.name, 'zzz')), lower(m.item_name))
      from public.menu_prices m
      left join public.menu_categories c on c.id = m.category_id
      where m.canteen_id = p_canteen_id
    ), '[]'::jsonb),
    'today', v_today,
    'today_menu', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_code', d.item_code, 'item_name', d.item_name, 'unit_price', d.unit_price,
        'active', coalesce(d.active, false), 'pooling_special', coalesce(d.pooling_special, false)
      ) order by lower(d.item_name))
      from public.daily_menu d
      where d.canteen_id = p_canteen_id and d.menu_date = v_today
    ), '[]'::jsonb),
    'weekly', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', w.weekday, 'item_code', w.item_code, 'item_name', w.item_name,
        'unit_price', w.unit_price, 'active', coalesce(w.active, false)
      ) order by w.weekday, lower(w.item_name))
      from public.weekly_menu w
      where w.canteen_id = p_canteen_id
    ), '[]'::jsonb)
  );
end
$function$;

revoke all on function public.super_admin_canteen_members(uuid) from public, anon;
revoke all on function public.super_admin_canteen_menu(uuid) from public, anon;
grant execute on function public.super_admin_canteen_members(uuid) to authenticated;
grant execute on function public.super_admin_canteen_menu(uuid) to authenticated;
