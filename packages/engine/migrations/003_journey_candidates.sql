alter table sweep_pages add column signals jsonb not null default '{}'::jsonb;

create table journey_candidates (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references apps(id) on delete cascade,
  name text not null,
  entry_url text not null,
  recommended boolean not null default false,
  feasibility_hint text,
  status text not null default 'open'
    check (status in ('open', 'selected', 'needs_info', 'authored', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (app_id, name)
);
