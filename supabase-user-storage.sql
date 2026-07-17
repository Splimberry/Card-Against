create table if not exists public.user_storage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_storage enable row level security;

create policy "Users can read their own storage"
on public.user_storage
for select
using (auth.uid() = user_id);

create policy "Users can insert their own storage"
on public.user_storage
for insert
with check (auth.uid() = user_id);

create policy "Users can update their own storage"
on public.user_storage
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
