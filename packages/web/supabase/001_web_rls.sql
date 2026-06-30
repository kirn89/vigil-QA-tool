-- Web auth/RLS layer. Applied to SUPABASE ONLY (auth schema required). Never run
-- through the engine migrate() runner (embedded Postgres has no auth.uid()).

alter table users add column if not exists auth_id uuid unique;

alter table users enable row level security;
alter table apps enable row level security;
alter table flows enable row level security;
alter table runs enable row level security;
alter table sweeps enable row level security;
alter table sweep_pages enable row level security;
alter table sweep_findings enable row level security;
alter table journey_candidates enable row level security;

drop policy if exists web_users_select on users;
create policy web_users_select on users for select to authenticated
  using (auth_id = auth.uid());

drop policy if exists web_apps_select on apps;
create policy web_apps_select on apps for select to authenticated
  using (user_id in (select id from users where auth_id = auth.uid()));

drop policy if exists web_flows_select on flows;
create policy web_flows_select on flows for select to authenticated
  using (app_id in (select a.id from apps a join users u on u.id = a.user_id where u.auth_id = auth.uid()));

drop policy if exists web_runs_select on runs;
create policy web_runs_select on runs for select to authenticated
  using (flow_id in (select f.id from flows f join apps a on a.id = f.app_id join users u on u.id = a.user_id where u.auth_id = auth.uid()));

drop policy if exists web_sweeps_select on sweeps;
create policy web_sweeps_select on sweeps for select to authenticated
  using (app_id in (select a.id from apps a join users u on u.id = a.user_id where u.auth_id = auth.uid()));

drop policy if exists web_sweep_pages_select on sweep_pages;
create policy web_sweep_pages_select on sweep_pages for select to authenticated
  using (sweep_id in (select s.id from sweeps s join apps a on a.id = s.app_id join users u on u.id = a.user_id where u.auth_id = auth.uid()));

drop policy if exists web_sweep_findings_select on sweep_findings;
create policy web_sweep_findings_select on sweep_findings for select to authenticated
  using (app_id in (select a.id from apps a join users u on u.id = a.user_id where u.auth_id = auth.uid()));

drop policy if exists web_journey_candidates_select on journey_candidates;
create policy web_journey_candidates_select on journey_candidates for select to authenticated
  using (app_id in (select a.id from apps a join users u on u.id = a.user_id where u.auth_id = auth.uid()));

alter table jobs enable row level security;

drop policy if exists web_jobs_select on jobs;
create policy web_jobs_select on jobs for select to authenticated
  using (app_id in (select a.id from apps a join users u on u.id = a.user_id where u.auth_id = auth.uid()));

drop policy if exists web_jobs_insert on jobs;
create policy web_jobs_insert on jobs for insert to authenticated
  with check (type = 'check_now' and app_id in (select a.id from apps a join users u on u.id = a.user_id where u.auth_id = auth.uid()));
