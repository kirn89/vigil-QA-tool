create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

create table apps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  name text not null,
  production_url text not null,
  preview_url text,
  credentials_encrypted text,
  status text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table flows (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references apps(id) on delete cascade,
  name text not null,
  status text not null default 'confirmed' check (status in ('proposed', 'confirmed', 'paused')),
  golden_path jsonb not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  unique (app_id, name)
);

create table runs (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references flows(id) on delete cascade,
  environment text not null default 'production' check (environment in ('production', 'preview')),
  verdict text not null check (verdict in ('pass', 'broken', 'unsure')),
  failed_step_id text,
  attempts jsonb not null,
  duration_ms int not null,
  created_at timestamptz not null default now()
);
create index runs_flow_created_idx on runs (flow_id, created_at desc);

create table sweeps (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references apps(id) on delete cascade,
  pages_visited int not null,
  started_at timestamptz not null default now()
);

create table sweep_pages (
  sweep_id uuid not null references sweeps(id) on delete cascade,
  url text not null,
  http_status int not null,
  load_ms int not null,
  primary key (sweep_id, url)
);

create table sweep_findings (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references apps(id) on delete cascade,
  page_url text not null,
  kind text not null check (kind in ('dead_link','console_error','failed_request','broken_image','unrendered','slow')),
  evidence text not null,
  fingerprint text not null,
  consecutive_count int not null default 1,
  status text not null default 'open' check (status in ('open', 'resolved')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (app_id, fingerprint)
);
