# Vigil engine — nightly watcher / on-demand runner.
# Build context is the repo root (see deploy/docker-compose.yml: context is ..).
#
# The Playwright base image ships Chromium + every OS library it needs + Node,
# pinned to the same Playwright version the engine uses (1.60.0). That removes the
# whole `playwright install --with-deps` apt dance — the browser is already here.
FROM mcr.microsoft.com/playwright:v1.60.0-noble

# Browsers come from the base image; never re-download them during npm install.
ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# pnpm, pinned to the version that wrote the lockfile (lockfileVersion 9.0).
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# Workspace manifests + sources. node_modules is excluded via .dockerignore, so the
# host's modules never leak in. --ignore-scripts skips postinstalls we don't want in
# an image (embedded-postgres' binary download, playwright's browser fetch); the
# runtime deps (pg, playwright, tsx, commander, zod, openai) need no postinstall.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile --ignore-scripts

WORKDIR /app/packages/engine

# `pnpm <script-or-arg>` from here: default is the nightly watch. Override at run time,
# e.g. `docker compose run --rm engine migrate` or `... vigil sweep <app> --deep`.
ENTRYPOINT ["pnpm"]
CMD ["vigil", "nightly"]
