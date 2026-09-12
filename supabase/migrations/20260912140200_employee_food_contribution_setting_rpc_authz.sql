create or replace function public.employee_food_contribution_setting_for_employee(p_employee_id uuid)
returns table(contribution_mode text,employee_contribution_percentage numeric,fixed_monthly_amount numeric)
language plpgsql security definer set search_path='public' as $$
declare v_canteen uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 v_canteen:=public.current_canteen_id(); if v_canteen is null then raise exception 'Canteen context required'; end if;
 if p_employee_id is null then raise exception 'Employee required'; end if;
 if auth.uid()<>p_employee_id and not public.has_admin_permission('payments') and not public.has_admin_permission('orders') then raise exception 'Not authorized'; end if;
 return query select coalesce(s.contribution_mode,g.contribution_mode,'percentage'),coalesce(s.employee_contribution_percentage,g.employee_contribution_percentage,0),coalesce(s.fixed_monthly_amount,g.fixed_monthly_amount,0)
 from public.profiles p left join public.employee_food_arrangement_settings s on s.canteen_id=v_canteen and s.employee_id=p.id left join public.employee_food_arrangement_settings g on g.canteen_id=v_canteen and g.employee_id is null
 where p.id=p_employee_id and p.role='employee' and p.canteen_id=v_canteen;
end;$$;
revoke execute on function public.employee_food_contribution_setting_for_employee(uuid) from anon,public;
grant execute on function public.employee_food_contribution_setting_for_employee(uuid) to authenticated;
notify pgrst,'reload schema';
