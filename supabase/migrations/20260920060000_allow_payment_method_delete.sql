-- Allow payment-method deletion without losing historical payment records.
-- subscription_payments.payment_method_id already uses ON DELETE SET NULL;
-- historical payment_method_snapshot remains untouched.
create or replace function public.super_admin_set_payment_method(
 p_method_id uuid default null,
 p_provider text default 'manual',
 p_method_type text default 'upi',
 p_display_name text default null,
 p_upi_id text default null,
 p_active boolean default true,
 p_is_default boolean default false,
 p_action text default 'upsert'
)
returns public.subscription_payment_methods
language plpgsql
security definer
set search_path=''
as $$
declare
 m public.subscription_payment_methods;
 v_default_id uuid;
begin
 if not public.is_super_admin() then raise exception 'Super Admin authorization required'; end if;

 if p_action='delete' then
   select * into m from public.subscription_payment_methods where id=p_method_id for update;
   if not found then raise exception 'Payment method not found'; end if;

   delete from public.subscription_payment_methods
   where id=p_method_id
   returning * into m;

   if m.is_default then
     select id into v_default_id
     from public.subscription_payment_methods
     where active
     order by created_at asc
     limit 1;

     if v_default_id is not null then
       update public.subscription_payment_methods
       set is_default=true,updated_at=now()
       where id=v_default_id;
     end if;
   end if;

   return m;
 elsif p_action='deactivate' then
   update public.subscription_payment_methods
   set active=false,is_default=false,updated_at=now()
   where id=p_method_id
   returning * into m;

   if not found then raise exception 'Payment method not found'; end if;
   return m;
 elsif p_action='upsert' then
   if p_provider<>'manual' then raise exception 'Razorpay is not configured in this phase'; end if;
   if nullif(trim(coalesce(p_display_name,'')),'') is null then raise exception 'Display name is required'; end if;
   if p_method_type='upi' and nullif(trim(coalesce(p_upi_id,'')),'') is null then raise exception 'UPI ID is required'; end if;

   if p_is_default then
     update public.subscription_payment_methods
     set is_default=false,updated_at=now()
     where id<>coalesce(p_method_id,'00000000-0000-0000-0000-000000000000'::uuid);
   end if;

   if p_method_id is null then
     insert into public.subscription_payment_methods(provider,method_type,display_name,upi_id,active,is_default)
     values('manual',p_method_type,trim(p_display_name),nullif(trim(p_upi_id),''),p_active,p_is_default)
     returning * into m;
   else
     update public.subscription_payment_methods
     set provider='manual',method_type=p_method_type,display_name=trim(p_display_name),
         upi_id=nullif(trim(p_upi_id),''),active=p_active,is_default=p_is_default,updated_at=now()
     where id=p_method_id
     returning * into m;
     if not found then raise exception 'Payment method not found'; end if;
   end if;
   return m;
 end if;

 raise exception 'Unsupported payment method action';
end
$$;

revoke execute on function public.super_admin_set_payment_method(uuid,text,text,text,text,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.super_admin_set_payment_method(uuid,text,text,text,text,boolean,boolean,text) to authenticated;

-- Keep the historical snapshot independent of the current method record.
do $$
declare fk_name text;
begin
 select conname into fk_name
 from pg_constraint
 where conrelid='public.subscription_payments'::regclass
   and conname='subscription_payments_payment_method_id_fkey';
 if fk_name is not null then
   execute 'alter table public.subscription_payments drop constraint '||quote_ident(fk_name);
 end if;
end $$;

alter table public.subscription_payments
 add constraint subscription_payments_payment_method_id_fkey
 foreign key(payment_method_id)
 references public.subscription_payment_methods(id)
 on delete set null;