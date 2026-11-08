-- Add multi-question support
alter table public.polls add column if not exists questions jsonb not null default '[]'::jsonb;
alter table public.poll_responses add column if not exists answers jsonb not null default '{}'::jsonb;
