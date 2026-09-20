-- Multiple MEMBER_RANGE pricing slabs are stored within one plan; do not block plans because their compatibility min/max overlap another plan.
create or replace function public.validate_subscription_plan_member_range()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;
  if new.pricing_model not in ('MEMBER_RANGE','FIXED_AMOUNT') then raise exception 'Invalid pricing model'; end if;
  if new.monthly_price is null or new.monthly_price<0 or new.annual_price is null or new.annual_price<0 then raise exception 'Monthly and Annual prices must be zero or greater'; end if;
  if new.pricing_model='MEMBER_RANGE' then
    if new.min_members is null or new.max_members is null or new.min_members<0 or new.max_members<new.min_members then raise exception 'Invalid member range: Minimum Members must be >= 0 and Maximum Members must be >= Minimum Members'; end if;
  else
    new.min_members:=null; new.max_members:=null; new.billing_cycle:='monthly';
  end if;
  new.price:=new.monthly_price; new.billing_period:='monthly'; return new;
end $$;