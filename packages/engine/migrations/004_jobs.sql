create table jobs (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references apps(id) on delete cascade,
  type text not null check (type in ('check_now')),
  environment text not null default 'production' check (environment in ('production', 'preview')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  error text,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index jobs_claim_idx on jobs (status, requested_at);
