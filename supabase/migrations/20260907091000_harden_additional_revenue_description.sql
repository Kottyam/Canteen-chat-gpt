alter table public.additional_revenues drop constraint if exists additional_revenues_description_nonempty;
alter table public.additional_revenues add constraint additional_revenues_description_nonempty check (length(trim(description)) > 0);
