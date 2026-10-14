# Worker Environment Variables

Per-variable reference for the worker `.env` template in [README.md](./README.md#environment-variables).


Variable purposes:

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL used by web scripts and standalone workers.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Public Supabase key required by the web runtime configuration.
- `SUPABASE_SERVICE_ROLE_KEY`: Server-only Supabase key for worker writes; never expose it to browsers or commit it.
- `SUPABASE_JUMIA_CREDENTIAL_KEY`: Dedicated server-only Supabase key for the restricted Jumia credential RPC; it must be configured separately from the generic worker service-role key.
- `IMEI_IDENTIFIER_ENCRYPTION_KEY`: Server-only key used to decrypt identifiers for claimed Petrock reconciliation work.
- `PETROCK_API_TOKEN`: Petrock reseller API token required by the direct reconciliation worker.
- `PETROCK_API_BASE_URL`: Optional Petrock reseller API base; defaults to the production reseller endpoint.
- `PETROCK_ENABLED`, `PETROCK_ENABLED_TIERS`, `PETROCK_REMEDIATION_ENABLED`: Explicit Petrock rollout values copied from the reviewed web production configuration. The direct-worker preflight requires all three to prevent an accidental configuration mismatch.
- `GIGL_BASE_URL`, `GIGL_EMAIL`, `GIGL_PASSWORD`: GIGL provider configuration used by the direct shipment-tracking worker. The base URL must be credential-free HTTPS.
- `GIGL_TRACKING_WORKER_TOKEN`: Signed, time-bounded PostgREST token whose `role` is exactly `gigl_tracking_worker`. Mint it outside the VPS with a trusted Supabase signing key, store only the scoped token on the VPS, and rotate it before its expiry. Never copy a JWT signing key or service-role credential to the worker host. Release and readiness gates perform a non-mutating live call to one of the five lease-bound wrappers before accepting the credential.
- `QUIZ_PHASE`, `QUIZ_PRODUCTION_APPROVED`: Explicit quiz launch gate values copied from web production. They must be present even for the fail-closed `1a`/`false` state.
- `QUIZ_RPC_SERVER_SECRET`, `QUIZ_DEVICE_HASH_PEPPER`: Required by the shared environment schema when `QUIZ_PHASE=production`; the device pepper must be at least 32 characters.
- `EXPO_ACCESS_TOKEN`: Optional Expo token used for authenticated push delivery. Receipt polling and unrelated direct workers remain deployable when it is absent.
- `JUMIA_CLIENT_ID`: Jumia application/client identifier used when refreshing integration credentials.
- `JUMIA_AUTHORIZATION_ENCRYPTION_KEY`: Base64-encoded 32-byte server-only key used to decrypt and rotate self-authorized Jumia grants.
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
- `BACI_POSTHOG_REMEDIATION_OUTPUT_DIR`: Separate prompt/state directory for PostHog Error Tracking issues.
- `BACI_POSTHOG_REMEDIATION_ENABLED`: Explicit opt-in for the PostHog remediator. It defaults to `0`; set it to `1` only after the dedicated PostHog credentials are installed.
- `BACI_REMEDIATION_STATE_PATH`: Optional deduplication state path. The worker records each fingerprint and last-seen observation atomically so unchanged incidents do not wake Codex repeatedly. Per-source workers override this with their own state path (see below).
- `BACI_POSTHOG_REMEDIATION_STATE_PATH`: Optional deduplication state path for the PostHog remediator. Defaults to `<BACI_POSTHOG_REMEDIATION_OUTPUT_DIR>/handled-state.json`; replaces `BACI_REMEDIATION_STATE_PATH` for this worker when set or defaulted.
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
- `POSTHOG_REMEDIATION_HOST`, `POSTHOG_REMEDIATION_PROJECT_ID`, `POSTHOG_REMEDIATION_PERSONAL_API_KEY`: Server-only PostHog Error Tracking API configuration. Create a separate personal API key limited to `error_tracking:read`; do not reuse a `phc_` project ingestion key, a source-map upload key, or a general automation credential. The worker rejects ingestion-key-shaped values before any network request and never passes this key to Codex or test subprocesses.
- `BACI_POSTHOG_REMEDIATION_MAX_PAGES`: Maximum offset pages inspected before failing closed. The worker requests at most 100 issue summaries per page, defaults to `10`, and has a hard cap of `10` pages. Occurrence counts are measured over the trailing 7 days.
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

