# VPS Workers Runbook

Vercel cron scheduling is disabled in `vercel.json`. Production schedules live in `vps-workers/deploy.sh`, which installs a delimited `baci-workers` crontab block on the VPS.

The web cron API routes under `apps/web/src/app/api/cron/` remain as manual fallbacks only. Do not re-enable Vercel Cron for these routes unless the VPS worker architecture is intentionally rolled back. When adding or removing cron routes, update this runbook and `vps-workers/deploy.sh` in the same PR so the documented manual fallback surface stays aligned with the deployed worker schedule.

Manual fallback invocation requires the existing `CRON_SECRET` authentication. Prefer running the matching VPS worker directly when possible, for example:

```bash
cd /home/bassey/baci-workers
export NODE_ENV=production
bin/sync-jumia-orders.sh
```

`bin/sync-jumia-orders.sh` is a worker checkout wrapper. It delegates to the TypeScript Baci checkout under `/opt/baci/app` by default, or to `BACI_REPO_DIR` when that environment variable is set.

For the import queue, run the repo-backed script from the worker checkout:

```bash
export NODE_ENV=production
/home/bassey/baci-workers/bin/process-import-jobs.sh
```

For async Gemma storefront generation, run the repo-backed storefront worker
from the worker checkout:

```bash
export NODE_ENV=production
/home/bassey/baci-workers/bin/process-ai-storefront-jobs.sh
```

The normal production path is event-triggered, not polling-first. Web enqueue
paths POST a signed request to the VPS trigger listener at
`/ai-storefront/trigger`; the listener starts
`bin/process-ai-storefront-jobs.sh` immediately under the shared Ollama and
storefront worker locks. Cron remains as a 10-minute recovery sweep for missed
triggers, service restarts, or temporarily failed web-to-VPS calls.

The import queue, Jumia order sync, and async storefront generation runners execute web-owned TypeScript entrypoints through `tsx` from a separate Baci repo checkout. `tsx` stays in `devDependencies` to avoid expanding the Next.js production dependency surface, so this full checkout must install development dependencies until those entrypoints are compiled to JavaScript before deployment.

That Baci checkout is separate from the `vps-workers` deployment directory installed by `deploy.sh`. `vps-workers/deploy.sh` always installs the worker directory with `pnpm install --frozen-lockfile --prod`.

The separate Baci checkout must use a full workspace install (`pnpm install --frozen-lockfile`, not `--prod`) until the TypeScript worker entrypoints are compiled to JavaScript. Use the repo's normal pnpm/turbo commands for validation and app workflows.

## Separate Baci Checkout for TypeScript Runners

Use `/opt/baci/app` as the preferred full monorepo checkout for TypeScript-backed workers. If that path is not available, set `BACI_REPO_DIR` in the worker environment to the checkout that contains `apps/web`.

Initial setup:

```bash
sudo mkdir -p /opt/baci
sudo chown -R bassey:bassey /opt/baci
git clone git@github.com:ogabasseyy/Baci.git /opt/baci/app
cd /opt/baci/app
pnpm install --frozen-lockfile
```

Do not install this checkout with `--prod`; `tsx` and the workspace development toolchain must remain available until these TypeScript entrypoints are compiled before deployment. Keep this checkout on the same deployed commit as the worker schedule when promoting VPS cron changes.

Some cron work intentionally remains in the web app because it needs web-only runtime integrations. The VPS schedule calls these CRON_SECRET-gated routes through `node jobs/run-web-cron.mjs <path>`:

- `/api/cron/cleanup-orders`, scheduled daily at 01:00.
- `/api/ai-jobs/worker`, scheduled daily at 02:00.
- `/api/cron/sync-petrock-catalog`, scheduled daily at 02:15. It refreshes the
  service-role-only Petrock IMEI product snapshot and reports low reseller
  balance without enabling any Petrock tier.
- `supabase-retention-cleanup`, scheduled daily at 03:20.
- `/api/cron/process-settlements`, scheduled daily at 05:00.
- `/api/cron/reconcile-vtu-processing`, scheduled every 5 minutes.
- `/api/cron/merchant-signup-health`, scheduled every 5 minutes. Verifies the
  merchant read/write policy shapes plus every authenticated grant used by
  mobile signup before and during `INSERT ... RETURNING`. Any drift returns non-2xx and logs
  `mobile-onboarding deployment_fault`. Every authorized run also emits the
  privacy-safe `admin_signup_health` PostHog event; telemetry failure never
  changes the health response. See `docs/ops/mobile-signup-monitoring.md`. Log:
  `/home/bassey/baci-workers/logs/merchant-signup-health.log`.
- `/api/cron/reconcile-gateway-paid-orders`, scheduled hourly at :20. Safety net behind the payment webhook's own heal-on-retry: heals "wedged" gateway orders (completed transaction, order never flipped to paid) after re-verifying with the gateway, then drains failed paid-order side effects (settlement / receipt email / ad tracking) for orders that are paid but whose outbox recorded a failure. Log: `/home/bassey/baci-workers/logs/reconcile-gateway-paid-orders.log`.
- `/api/cron/wallet-payouts`, scheduled daily at 06:00.
- `/api/cron/vtu-cashback-summaries`, scheduled monthly on the 1st at 08:30.
- `/api/cron/publish-scheduled-posts`, scheduled every 15 minutes.
- `/api/inventory/push-alerts`, scheduled every 6 hours.
- `/api/cron/storefront-update-nudge`, scheduled daily at 10:00 (server time / UTC). Pushes the "update available" notification to storefront installs on an older native build than `MOBILE_STOREFRONT_<PLATFORM>_LATEST_BUILD`; throttled per device server-side, so a daily cadence is safe and idempotent. **Config lives in the WEB (Vercel) env, not the worker `.env`:** `MOBILE_STOREFRONT_UPDATES_ENABLED`, `MOBILE_STOREFRONT_{ANDROID,IOS}_LATEST_BUILD`, `_STORE_URL`, and optionally `MOBILE_STOREFRONT_UPDATE_MESSAGE` (overrides the push body / in-app prompt copy). A platform with a missing/blank `LATEST_BUILD` or `_STORE_URL` is silently skipped (`skipped: 'no_latest_build'` / `'no_store_url'`, still HTTP 200) — set both per release. The route returns non-2xx (so `run-web-cron.mjs` exits non-zero and the schedule alerts) whenever **any** attempted platform fails: a thrown error, a delivered-nothing result (Expo/DB down), or a throttle-stamp write failure. Healthy platforms' sends still persist.
- `storefront_layout_generation` storefront worker, started immediately by
  `baci-ai-storefront-trigger.service` and swept every 10 minutes as a fallback:
  `*/10 * * * * flock -n /home/bassey/baci-workers/locks/ollama-workload.lock flock -n /home/bassey/baci-workers/locks/ai-storefront-jobs.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=ai-storefront-jobs && cd /home/bassey/baci-workers && /home/bassey/baci-workers/bin/process-ai-storefront-jobs.sh' >> /home/bassey/baci-workers/logs/ai-storefront-jobs.log 2>&1`

The VPS also runs `jobs/cleanup-agentic-request-records.mjs` directly against
Supabase at minute 10 of every hour. It deletes `agentic_request_records` only
after `expires_at` is at least one hour old, preserving the request replay and
order-read health observation window while bounding telemetry retention.

`/api/ai-jobs/worker` must remain limited to short web-safe jobs such as price
list processing. It must not claim `storefront_layout_generation`; those jobs
run through `/home/bassey/baci-workers/bin/process-ai-storefront-jobs.sh` via
the signed trigger service, with cron only as the 10-minute fallback sweep.

These entries require `BACI_WEB_BASE_URL` and `CRON_SECRET` in `/home/bassey/baci-workers/.env`. `BACI_WEB_BASE_URL` must be an `https://` TLS-terminated production web origin, for example `https://ogabassey.com`; do not use `http://` for production web cron calls because `CRON_SECRET` is sent on each request. `CRON_SECRET` must exist in both the VPS worker environment and the web deployment environment with the same value; rotate both copies together through the normal secret-management process.

## Direct Petrock and Quiz Minute Workers

Petrock reconciliation and quiz finalization run directly from the VPS every
minute through `bin/process-petrock-reconciliation.sh` and
`bin/process-quiz-finalization.sh`. This is the normal production path; the
existing `CRON_SECRET`-authenticated `/api/cron/petrock-reconcile` and
`/api/quiz/finalize` routes remain manual fallbacks only.

The direct workers load the full Baci checkout environment and use server-side
Supabase/admin access. They do not call Vercel or send `CRON_SECRET`. Petrock
requires a credential-free HTTPS `BACI_WEB_BASE_URL` only to construct
remediation URLs; quiz uses the existing `QUIZ_PHASE` and
`QUIZ_PRODUCTION_APPROVED` gate variables. Preserve the existing locks, cadence,
and logs: `/home/bassey/baci-workers/logs/petrock-reconcile.log` and
`/home/bassey/baci-workers/logs/quiz-finalize.log`.

Before the crontab is installed, `deploy.sh` runs a non-secret environment
preflight. The VPS `.env` must contain the same reviewed Petrock token,
identifier encryption key, rollout flags, and explicit quiz gate values as web
production, plus the Supabase server/public values used by the imported web
graph. `QUIZ_PHASE=production` additionally requires
`QUIZ_RPC_SERVER_SECRET` and a 32-character-or-longer
`QUIZ_DEVICE_HASH_PEPPER`. The preflight prints only missing/invalid variable
names and aborts deployment; each direct CLI repeats the essential check so a
later configuration deletion cannot become a successful no-op.

The deploy script also compares the configured VPS `BACI_REPO_DIR` checkout
against the exact deploying Git SHA and verifies both direct scripts plus the
`tsx` runtime before changing crontab. It refuses dirty local source. Promote
the reviewed full checkout and install it with the frozen workspace lockfile
before deploying the worker schedule.

Both CLIs exit nonzero on an operational failure and emit only sanitized result
summaries, so inspect those persistent logs first. There is no verified pager
or alert-delivery transport for these failures; configure and test one before
treating logs as an active alert.

The hosted Cerebras-first chain is the active Builder and shared-text path.
The VPS Ollama/Gemma worker is retained only as a legacy full-layout
compatibility path for historical and explicitly created
`storefront_layout_generation` jobs. It still requires
`OLLAMA_STOREFRONT_BASE_URL` in the worker `.env`; retain its signed trigger,
shared locks, and 10-minute fallback sweep until a separately approved queue
and usage audit permits retirement. `AI_STOREFRONT_GENERATION_ENABLED` remains
parseable for compatibility only: onboarding no longer produces jobs from it,
and the VPS processor never reads it as a pause switch.

The trigger listener requires `AI_STOREFRONT_TRIGGER_SECRET` in the VPS worker
environment. Keep `AI_STOREFRONT_TRIGGER_HOST=127.0.0.1` and expose only a
TLS-terminated reverse proxy path to `/ai-storefront/trigger`. The web
deployment needs the matching `AI_STOREFRONT_TRIGGER_URL` and
`AI_STOREFRONT_TRIGGER_SECRET`; when those are absent, enqueueing still works
and cron performs the fallback sweep.

## Troubleshooting

If `process-import-jobs.sh` or `sync-jumia-orders.sh` fails, inspect the matching log in `/home/bassey/baci-workers/logs/` first. Stale locks can be checked with `ls -la /home/bassey/baci-workers/locks`; only remove a lock after confirming no matching worker process is running. Missing environment values should be fixed in `/home/bassey/baci-workers/.env` or the `BACI_WORKER_ENV` file used by cron.

If `process-ai-storefront-jobs.sh` fails, inspect
`/home/bassey/baci-workers/logs/ai-storefront-jobs.log` and confirm Ollama is
reachable from the VPS at `OLLAMA_STOREFRONT_BASE_URL`. The compatibility-only
`AI_STOREFRONT_GENERATION_ENABLED` flag does not pause this processor; inspect
queue metadata, trigger health, and the fallback sweep when historical jobs
need attention.

If web-created storefront jobs do not start immediately, check the trigger
service first:

```bash
systemctl --user status baci-ai-storefront-trigger.service
journalctl --user -u baci-ai-storefront-trigger.service -n 100 --no-pager
```

Then verify the reverse proxy reaches `127.0.0.1:3917`, the web deployment and
VPS worker share the same `AI_STOREFRONT_TRIGGER_SECRET`, and the worker lock
files do not correspond to an actively running process.

If a web cron wrapper fails, inspect the matching log first: `/home/bassey/baci-workers/logs/ai-jobs-worker.log`, `/home/bassey/baci-workers/logs/reconcile-vtu-processing.log`, `/home/bassey/baci-workers/logs/wallet-payouts.log`, `/home/bassey/baci-workers/logs/publish-scheduled-posts.log`, or `/home/bassey/baci-workers/logs/inventory-push-alerts.log`. A 401 almost always means the VPS `CRON_SECRET` does not match the web deployment. For request-retention cleanup failures, inspect `/home/bassey/baci-workers/logs/cleanup-agentic-request-records.log` and confirm the server-only Supabase worker credentials are current.

If Supabase storage or database usage starts rising unexpectedly, inspect
`/home/bassey/baci-workers/logs/cleanup-import-uploads.log` and
`/home/bassey/baci-workers/logs/supabase-retention-cleanup.log`. The import
cleanup removes stale terminal import preview rows and migration CSVs after
`IMPORT_JOB_RETENTION_DAYS` days, while the retention worker bounds low-value
analytics events, `cron.job_run_details`, and `net._http_response`.

If a repo-backed TypeScript runner reports that `tsx` is missing, the separate Baci checkout used to run the web script was likely installed with production-only dependencies. Run `pnpm install --frozen-lockfile` in that checkout, then rerun the affected `/home/bassey/baci-workers/bin/*.sh` script.

Rotate `/home/bassey/baci-workers/logs/process-import-jobs.log` and the rest of `/home/bassey/baci-workers/logs/` with logrotate or a cron-based size/age policy so worker logs do not grow without bound. If disk space is already low, archive or truncate the affected log only after confirming the worker is not actively writing to it.
