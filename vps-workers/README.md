# VPS Workers

`deploy.sh` syncs only this `vps-workers` directory to
`/home/bassey/baci-workers` and installs the worker package with
`pnpm install --frozen-lockfile --prod`.

This package is intentionally installed outside the root pnpm workspace, so it
keeps its own `pnpm-lock.yaml` for frozen production installs.

The Jumia order sync, import queue, and AI storefront generation wrappers do not run TypeScript from this
production-only worker install. They delegate to a separate full Baci monorepo
checkout, resolved from `BACI_REPO_DIR` or `/opt/baci/app`, via
`bin/run-web-script.sh`.

## Configuring BACI_REPO_DIR

`BACI_REPO_DIR` points `bin/run-web-script.sh` at the full Baci checkout that
contains `apps/web`. If it is unset, the wrapper first tries `/opt/baci/app`.
The configured path must exist, be readable by the worker user, and contain the
expected monorepo files used by the wrapper.

Common configurations:

```bash
export BACI_REPO_DIR=/opt/baci/app
```

```ini
Environment=BACI_REPO_DIR=/opt/baci/app
```

```yaml
environment:
  BACI_REPO_DIR: /opt/baci/app
```

That full checkout must be installed with:

```bash
pnpm install --frozen-lockfile
```

The VPS wrappers run `apps/web/src/scripts/process-import-jobs.ts`,
`apps/web/src/scripts/sync-jumia-orders.ts`, and
`apps/web/src/scripts/process-ai-storefront-jobs.ts` directly through the
`tsx` runtime dependency in the full checkout, with no prior compilation step.
That dependency is not part of the standalone `/home/bassey/baci-workers`
production-only install, so keep the separate `apps/web` checkout dependencies
installed before enabling these cron entries.

The web app only creates and updates Bumpa import job records in production.
Scheduled processing is owned by the VPS cron entry for
`bin/process-import-jobs.sh`; do not add a Vercel Function or Vercel Cron for
`/api/import-jobs/worker`.

Import processing can run longer and use more CPU or memory than a web request
should. Keeping it on the VPS isolates Bumpa imports from storefront traffic and
avoids Vercel Function execution limits.

`tsx` intentionally remains an `apps/web` production dependency while these
cron entrypoints execute TypeScript in production. Move it back to a
development-only dependency only after these scripts are compiled to JavaScript
and the wrappers are updated to run the compiled output.

## Environment Variables

Create `/home/bassey/baci-workers/.env` with the runtime secrets used by the
worker scripts:

```bash
touch /home/bassey/baci-workers/.env
chmod 600 /home/bassey/baci-workers/.env
```

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
IMEI_IDENTIFIER_ENCRYPTION_KEY=...
PETROCK_API_TOKEN=...
PETROCK_API_BASE_URL=https://api.petrock.biz/api/reseller/v1
PETROCK_ENABLED=true
PETROCK_ENABLED_TIERS=blacklist
PETROCK_REMEDIATION_ENABLED=true
QUIZ_PHASE=1a
QUIZ_PRODUCTION_APPROVED=false
# Required when QUIZ_PHASE=production:
QUIZ_RPC_SERVER_SECRET=...
QUIZ_DEVICE_HASH_PEPPER=...
EXPO_ACCESS_TOKEN=...
JUMIA_CLIENT_ID=...
BACI_WEB_BASE_URL=...
# Same server-side credential as the web internal revalidation endpoint.
INTERNAL_API_SECRET=...
CRON_SECRET=...
OLLAMA_STOREFRONT_BASE_URL=http://localhost:11434
OLLAMA_STOREFRONT_MODEL=gemma4:e4b
OLLAMA_STOREFRONT_TIMEOUT_MS=90000
AI_STOREFRONT_GENERATION_ENABLED=false
AI_STOREFRONT_TRIGGER_SECRET=...
AI_STOREFRONT_TRIGGER_HOST=127.0.0.1
AI_STOREFRONT_TRIGGER_PORT=3917
IMPORT_JOB_TRIGGER_SECRET=...
IMPORT_JOB_TRIGGER_HOST=127.0.0.1
IMPORT_JOB_TRIGGER_PORT=3918
VERCEL_ERROR_LOG_PATH=/home/bassey/baci-workers/logs/vercel-drain.jsonl
BACI_REMEDIATION_OUTPUT_DIR=/home/bassey/baci-workers/logs/vercel-error-remediator
BACI_SENTRY_REMEDIATION_OUTPUT_DIR=/home/bassey/baci-workers/logs/sentry-mobile-error-remediator
BACI_REMEDIATION_MIN_OCCURRENCES=2
BACI_REMEDIATION_AUTOFIX_ENABLED=0
BACI_REPO_DIR=/opt/baci/app
CI=true
PUPPETEER_SKIP_DOWNLOAD=1
BACI_REMEDIATION_WORKTREE_ROOT=/opt/baci/remediation-worktrees
BACI_REMEDIATION_NOTIFY_EMAILS=owner@example.com
SENTRY_REMEDIATION_AUTH_TOKEN=...
SENTRY_ORG=...
SENTRY_PROJECT=...
SENTRY_URL=https://sentry.io/
VERCEL_LOG_DRAIN_SECRET=...
VERCEL_LOG_DRAIN_RECEIVER_PORT=8787
VERCEL_ERROR_LOG_MAX_BYTES=33554432
VERCEL_ERROR_LOG_MAX_ROTATED_FILES=2
BACI_WORKER_LOG_MAX_BYTES=33554432
BACI_WORKER_LOG_MAX_ROTATED_FILES=2
BACI_REMEDIATION_ORPHAN_STORE_RETENTION_HOURS=24
IMPORT_JOB_RETENTION_DAYS=30
ANALYTICS_LOW_VALUE_RETENTION="30 days"
SUPABASE_CRON_LOG_RETENTION="14 days"
SUPABASE_PG_NET_RETENTION="1 day"
```

Do not commit this file or any `.env*` file to version control. Keep those
files covered by `.gitignore` and manage the values through the deployment
secret process.

Variable purposes:

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL used by web scripts and standalone workers.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Public Supabase key required by the web runtime configuration.
- `SUPABASE_SERVICE_ROLE_KEY`: Server-only Supabase key for worker writes; never expose it to browsers or commit it.
- `IMEI_IDENTIFIER_ENCRYPTION_KEY`: Server-only key used to decrypt identifiers for claimed Petrock reconciliation work.
- `PETROCK_API_TOKEN`: Petrock reseller API token required by the direct reconciliation worker.
- `PETROCK_API_BASE_URL`: Optional Petrock reseller API base; defaults to the production reseller endpoint.
- `PETROCK_ENABLED`, `PETROCK_ENABLED_TIERS`, `PETROCK_REMEDIATION_ENABLED`: Explicit Petrock rollout values copied from the reviewed web production configuration. The direct-worker preflight requires all three to prevent an accidental configuration mismatch.
- `QUIZ_PHASE`, `QUIZ_PRODUCTION_APPROVED`: Explicit quiz launch gate values copied from web production. They must be present even for the fail-closed `1a`/`false` state.
- `QUIZ_RPC_SERVER_SECRET`, `QUIZ_DEVICE_HASH_PEPPER`: Required by the shared environment schema when `QUIZ_PHASE=production`; the device pepper must be at least 32 characters.
- `EXPO_ACCESS_TOKEN`: Expo token used for push notification delivery and related mobile app operations.
- `JUMIA_CLIENT_ID`: Jumia application/client identifier used when refreshing integration credentials.
- `BACI_WEB_BASE_URL`: HTTPS base URL for retained web cron endpoint calls and direct Petrock remediation URLs, for example `https://ogabassey.com`. Direct Petrock execution rejects credentials and non-HTTPS values.
- `CRON_SECRET`: Shared secret that must match the web deployment and protect cron endpoints.
- `OLLAMA_STOREFRONT_BASE_URL`: Local/private Ollama base URL for async storefront generation. Use `http://localhost:11434` when Ollama runs on the same VPS.
- `OLLAMA_STOREFRONT_MODEL`: Gemma model used for storefront layout generation.
- `OLLAMA_STOREFRONT_TIMEOUT_MS`: Per-request Ollama timeout for the storefront worker.
- `AI_STOREFRONT_GENERATION_ENABLED`: Parseable compatibility no-op; it no longer enqueues onboarding jobs or pauses the worker.
- `AI_STOREFRONT_TRIGGER_SECRET`: Bearer secret required by the local trigger listener before it starts the storefront worker.
- `AI_STOREFRONT_TRIGGER_HOST`: Bind host for the trigger listener. Keep the default `127.0.0.1` and expose it only through an HTTPS reverse proxy.
- `AI_STOREFRONT_TRIGGER_PORT`: Local trigger listener port. Default is `3917`.
- `IMPORT_JOB_TRIGGER_SECRET`: Bearer secret required by the local trigger listener before it starts the import worker for a finalized upload.
- `IMPORT_JOB_TRIGGER_HOST`: Bind host for the import trigger listener. Keep the default `127.0.0.1` and expose it only through an HTTPS reverse proxy.
- `IMPORT_JOB_TRIGGER_PORT`: Local import trigger listener port. Default is `3918`.
- `VERCEL_ERROR_LOG_PATH`: JSONL file written by the Vercel log-drain receiver or log export process. Each line must be one Vercel log event JSON object.
- `BACI_REMEDIATION_OUTPUT_DIR`: Directory where the remediator writes Codex prompts and reports.
- `BACI_SENTRY_REMEDIATION_OUTPUT_DIR`: Separate prompt/state directory for native mobile Sentry issues.
- `BACI_REMEDIATION_STATE_PATH`: Optional deduplication state path. The worker records each fingerprint and last-seen observation atomically so unchanged incidents do not wake Codex repeatedly.
- `BACI_REMEDIATION_MIN_OCCURRENCES`: Minimum repeated fingerprint count before the worker creates remediation work. Default is `2`.
- `BACI_REMEDIATION_MAX_CANDIDATES_PER_RUN`: Maximum candidates investigated during one worker tick. Defaults to `1` and is capped at `10` so a noisy backlog cannot monopolize the worker.
- `BACI_REMEDIATION_AUTOFIX_ENABLED`: Set to `1` only after Codex CLI and GitHub CLI are logged in on the VPS. Default/dry-run mode writes prompts and sends reports only.
- `BACI_CODEX_DOCKER_IMAGE`: Commit-tagged remediator image built and injected by `deploy.sh`. Do not set this manually in `.env`; the remediation cron entries own it.
- `BACI_CODEX_CONTAINER_BIN`: Native static Codex binary resolved and injected by `deploy.sh`; the JavaScript launcher is intentionally rejected by the container backend.
- `BACI_REPO_DIR`: Full Baci checkout used for autonomous fix PRs. The checkout must have `origin`, dependencies, `gh`, and Codex CLI access.
- `CI`: Keep set to `true` for cron/systemd worker runs so package-manager checks fail or repair non-interactively instead of prompting in a headless shell.
- `PUPPETEER_SKIP_DOWNLOAD`: Keep set to `1` for worker wrappers. The import/Jumia/AI wrappers do not need Puppeteer's managed browser, and skipping the browser download prevents dependency bootstrap from blocking cron jobs when a checkout is refreshed.
- `BACI_REMEDIATION_WORKTREE_ROOT`: Directory where isolated remediation worktrees are created. Defaults beside `BACI_REPO_DIR`.
- `BACI_REMEDIATION_RETAIN_FAILED_WORKTREE`: Set to `1` only for bounded debugging when an uncommitted failed attempt must be inspected. The default removes failed uncommitted worktrees and all per-run pnpm stores; committed attempts retain only the worktree needed for push/PR recovery.
- `BACI_REMEDIATION_NOTIFY_EMAILS`: Comma-separated report recipients. Requires `ZEPTOMAIL_TOKEN`; `ZEPTOMAIL_FROM_DOMAIN` defaults to `usebaci.com`.
- `SENTRY_REMEDIATION_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_URL`: Server-only Sentry issue API configuration used by the mobile remediator. Use a dedicated token with `event:read`; release/source-map upload credentials are not sufficient. These values are deliberately removed from the Codex and test subprocess environments.
- `BACI_SENTRY_REMEDIATION_MAX_PAGES`: Maximum Sentry issue pages inspected before failing closed. Each page requests Sentry's maximum 100 issues; default is `10` and the hard cap is `50`.
- `VERCEL_LOG_DRAIN_SECRET`: Shared secret used to verify Vercel Drain HMAC signatures before appending log events.
- `VERCEL_LOG_DRAIN_RECEIVER_PORT`: Local receiver port proxied by nginx. Default is `8787`.
- `VERCEL_ERROR_LOG_MAX_BYTES`: Maximum active Vercel drain size before rotation. Defaults to 32 MiB; one accepted request may temporarily exceed the bound by its payload size.
- `VERCEL_ERROR_LOG_MAX_ROTATED_FILES`: Number of active drain rotations retained. Defaults to `2`.
- `BACI_WORKER_LOG_MAX_BYTES`: Maximum size for each worker `.log` before the daily storage cleanup rotates it. Defaults to 32 MiB.
- `BACI_WORKER_LOG_MAX_ROTATED_FILES`: Number of worker log rotations retained by the daily storage cleanup. Defaults to `2`.
- `BACI_REMEDIATION_ORPHAN_STORE_RETENTION_HOURS`: Minimum age before an unregistered per-run pnpm store is removed. Defaults to `24` hours; cleanup fails closed if Git cannot enumerate registered worktrees.
- `IMPORT_JOB_RETENTION_DAYS`: Days to keep terminal import job previews and migration CSVs before cleanup. Default is `30`.
- `ANALYTICS_LOW_VALUE_RETENTION`: Retention interval for raw `page_view` and `search` analytics events. Default is `30 days`.
- `SUPABASE_CRON_LOG_RETENTION`: Retention interval for `cron.job_run_details`. Default is `14 days`.
- `SUPABASE_PG_NET_RETENTION`: Retention interval for `net._http_response`. Default is `1 day`.

### Runtime Checks and Rotation

Worker startup should fail closed when required variables are missing or
invalid. At minimum, validate `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, and the job-specific credentials
before work starts; log only the variable name and exit non-zero, never the
secret value.

`deploy.sh` runs `jobs/preflight-direct-web-workers.mjs` before installing the
crontab. The preflight checks the Supabase values, credential-free HTTPS web
origin, Petrock token/encryption key/rollout flags, explicit quiz gates, and
the two additional quiz production secrets. It prints only variable names and
fixed validation reasons, never values. Each direct TypeScript CLI repeats its
essential preflight at runtime so later configuration drift exits nonzero
instead of returning a successful skip.

Worker deployment also refuses a dirty local checkout and requires the
configured `BACI_REPO_DIR` checkout on the VPS to be at the exact same Git SHA
as the deploying repository, with both direct scripts and `tsx` present. Update
and install that full checkout first; the crontab is not replaced when this
readback fails.

To rotate a secret, generate the replacement value, deploy the updated `.env`
through the deployment secret store, restart the affected worker process, verify
successful cron execution, then revoke the old value. Rotate server-only values
such as `SUPABASE_SERVICE_ROLE_KEY`, `EXPO_ACCESS_TOKEN`, and `CRON_SECRET`
immediately after suspected exposure and on the normal security cadence.

`jobs/run-web-cron.mjs` calls the retained CRON_SECRET-gated web cron endpoints
for web-owned scheduled work. Every request sends `Authorization: Bearer
$CRON_SECRET`; `/api/cron/process-settlements` uses `POST` and the others use
`GET`:

- `/api/ai-jobs/worker`
- `/api/cron/agentic-commerce-health`
- `/api/cron/cleanup-orders`
- `/api/cron/process-settlements`
- `/api/cron/publish-scheduled-posts`
- `/api/cron/drain-cache-invalidations`
- `/api/cron/vtu-cashback-summaries`
- `/api/cron/wallet-payouts`
- `/api/inventory/push-alerts`

Petrock reconciliation and quiz finalization are deliberately absent from this
allowlist. Their minute schedules invoke `bin/process-petrock-reconciliation.sh`
and `bin/process-quiz-finalization.sh` directly against the full Baci checkout.
Those scripts use the server-side Supabase/admin and job-specific environment;
they do not send `CRON_SECRET` or make HTTP calls to the web deployment. A
nonzero exit is retained in the matching persistent cron log, but no verified
pager transport is configured.

Merchant cancellation refund and email outbox work uses the trusted
`/api/cron/process-settlements?cancellationsOnly=true` mode every five minutes;
the full settlement run remains daily.

`jobs/cleanup-agentic-request-records.mjs` is a direct database maintenance
worker scheduled hourly at minute 10. It uses `SUPABASE_SERVICE_ROLE_KEY` only
on the VPS to remove request records more than one hour past `expires_at`, so
agent route latency does not depend on retention cleanup.

`CRON_SECRET` must never be committed to source. Inject it through environment
variables or the project's secret manager, keep it aligned between the VPS
worker and web deployment, and rotate it through the normal secret-management
process. No API keys, passwords, or tokens should be stored in repo files.

The two-minute `drain-cache-invalidations` sweep uses only the existing
`BACI_WEB_BASE_URL` and `CRON_SECRET` web-cron boundary. The Next route claims
transactional cache targets and enforces Next → Vercel → Cloudflare ordering.
Its `flock` schedule retains a two-minute discovery bound until a durable queue
wake signal exists. A known dead-letter state is persisted in
`state/cache-invalidations.json`, so repeated sweeps do not report the same
condition as a new alert while newly enqueued work is still discovered within
two minutes. The executable loads `vps-workers/.env` before invoking the web
cron. This cache drainer never receives Supabase service-role or Cloudflare
credentials.

`/api/ai-jobs/worker` is intentionally retained only for short legacy web-safe
jobs such as price list processing. Long `storefront_layout_generation` jobs
must run through `bin/process-ai-storefront-jobs.sh`, which talks to local
Ollama from the VPS checkout and processes one job per invocation.

`jobs/ai-storefront-trigger-server.mjs` is the event-driven entrypoint for
storefront generation. `deploy.sh` installs it as the
`baci-ai-storefront-trigger.service` user service. The web app calls it after a
`storefront_layout_generation` job is enqueued, using the matching
`AI_STOREFRONT_TRIGGER_URL` and `AI_STOREFRONT_TRIGGER_SECRET` values in the web
deployment. The cron entry remains as a 10-minute fallback sweep, not the
primary scheduler.

`jobs/import-job-trigger-server.mjs` is the event-driven entrypoint for Bumpa
CSV preview generation. `deploy.sh` installs it as the
`baci-import-job-trigger.service` user service. The web app calls it after an
upload is finalized, using the matching `IMPORT_JOB_TRIGGER_URL` and
`IMPORT_JOB_TRIGGER_SECRET` values in the web deployment. The listener starts
`bin/process-import-jobs.sh` under `process-import-jobs.lock` with
`IMPORT_JOB_TRIGGER_JOB_ID`, so it targets the finalized upload immediately.
The hourly cron entry remains as a fallback sweep for missed signals, not the
primary scheduler.

## Production Error Remediators

See [REMEDIATION.md](./REMEDIATION.md) for Vercel drain ingestion, Sentry mobile
issue polling, deduplication, Codex isolation, draft-PR policy, and operations.
