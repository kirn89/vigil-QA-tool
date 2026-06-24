# Deploying the Vigil engine to a VPS

The engine runs headless Chromium, so it needs a long-running host (a small VPS —
Hetzner/Fly/Railway). Supabase/Vercel can't run it (function timeouts, no browser).
Data (Postgres + screenshots) lives in Supabase; this box just runs the browser work
on a nightly cron.

**Shape:** host cron → `docker compose run --rm engine` (default command `vigil
nightly`) → the container checks + sweeps every app, writes results to Supabase
Postgres and screenshots to Supabase Storage, then exits.

## One-time setup

1. **Provision a box** (e.g. Hetzner CX22, 2 vCPU / 4 GB, Ubuntu) and install Docker +
   the compose plugin.

2. **Get the code onto it** (clone the repo to `/opt/vigil`, or rsync it).

3. **Create `deploy/.env`** from the template and fill it in:
   ```bash
   cp packages/engine/.env.example deploy/.env
   # edit deploy/.env:
   #   DATABASE_URL   -> Supabase direct connection (port 5432)
   #   DATABASE_SSL=true
   #   VIGIL_SECRET_KEY, OPENROUTER_API_KEY
   #   SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_SCREENSHOT_BUCKET
   ```
   `deploy/.env` is gitignored — keep the service-role key on the server only.

4. **Build the image:**
   ```bash
   docker compose -f deploy/docker-compose.yml build
   ```

5. **Run migrations once** against Supabase:
   ```bash
   docker compose -f deploy/docker-compose.yml run --rm engine migrate
   ```

6. **Add your apps and confirm their flows** (one-time, uses the LLM for mapping):
   ```bash
   docker compose -f deploy/docker-compose.yml run --rm engine vigil app:add --name myapp --url https://myapp.com --login-email ... --login-password ...
   docker compose -f deploy/docker-compose.yml run --rm engine vigil map myapp
   docker compose -f deploy/docker-compose.yml run --rm engine vigil flow:confirm myapp <flow>
   ```

7. **Install the nightly cron** — see `deploy/crontab.example`:
   ```bash
   crontab -e
   # 0 3 * * * cd /opt/vigil && /usr/bin/docker compose -f deploy/docker-compose.yml run --rm engine >> /var/log/vigil-nightly.log 2>&1
   ```

## Running things by hand

```bash
# the nightly watch (what cron runs): check + sweep every app, then prune
docker compose -f deploy/docker-compose.yml run --rm engine vigil nightly

# a single on-demand check / sweep / report
docker compose -f deploy/docker-compose.yml run --rm engine vigil check myapp
docker compose -f deploy/docker-compose.yml run --rm engine vigil sweep myapp        # add --deep for SPA nav (never for settlenepal)
docker compose -f deploy/docker-compose.yml run --rm engine vigil report myapp

# trim old screenshots (also part of `nightly`)
docker compose -f deploy/docker-compose.yml run --rm engine vigil prune-screenshots --days 14
```

## Notes

- The Dockerfile is based on `mcr.microsoft.com/playwright:v1.60.0-noble`, which
  matches the engine's Playwright version and already contains Chromium + its OS
  libraries. If you bump the `playwright` dependency, bump the image tag to match.
- The container is **stateless and ephemeral** — every cron firing starts a fresh
  one and it exits when done. No always-on process, no in-container scheduler.
- Screenshots are pruned by the nightly run (default keep 14 days). Lower
  `--days` to control Supabase Storage egress/usage.
- Single-tenant for now: `nightly` runs **every** app in the database. Per-customer
  scheduling comes with the multi-tenant queue later.
