# GIGL tracking cutover runbook

The Vercel `*/5` tracking cron is removed; the VPS direct worker is the
only poller. Three gates protect the cutover, in run order:

1. **Cutover marker** (readiness, every main push): worker files +
   well-formed SHA + canonical crontab installed. Fails until
   `deploy.sh` has run at least once post-merge.
2. **Exact-SHA + capability smoke** (tracking changesets only):
   worker checkout equals the pushed commit; live token+hook
   verification after migrations.
3. **Cutover latch** (gate bypass for tracking=false pushes):
   `.gigl-capability-smoke-ok` on the worker host, written only by a
   passing smoke. Install presence alone cannot prove the worker
   FUNCTIONS, so web pushes stay blocked after a smoke failure until
   some smoke succeeds. The latch records `<scope>:<sha>:<fingerprint>`
   for the environment the smoke observed and is re-validated on every
   read: the installed SHA, the enablement scope, and the proven token
   fingerprint must all still match, or the bypass closes until
   re-smoked. Fingerprint binding is scope-agnostic: a disabled latch
   written with no usable token latches WITHOUT the live hook probe, so
   a token that appears afterwards forces a re-smoke. The latch also
   binds the token actually smoked: the persist step re-resolves the
   identity and refuses to write on any drift since the pre-smoke
   capture. The latch persists across `deploy.sh` promotes and never
   needs manual maintenance.

## Immutable worker checkouts

Cron executes the TypeScript poller from the `BACI_REPO_DIR` checkout,
so an in-place `git pull` there would change what the installed
schedule runs immediately — before prepare, migrations, or the
capability smoke complete. `deploy.sh` therefore never pulls in place:

- Prepare provisions an immutable per-SHA worktree
  (`<base>/app-<sha>`, detached, never pulled after creation),
  installs its dependencies, and smokes THAT revision.
- Promote flips the `BACI_REPO_DIR` symlink (`<base>/app-live`) to the
  new worktree atomically, inside the same deploy lock as the file
  promote — wrappers, SHA marker, and executed code change together,
  and no poll can straddle two revisions mid-run. Promote additionally
  holds the GIGL runtime lock exclusive, so a cron tick that would start
  between the file sync and the flip skips (one missed poll at most)
  instead of running mixed-revision wrappers against the old checkout.
- Old worktrees retire automatically (current + previous kept, older
  ones removed past a one-hour guard).

First deploy with this scheme migrates once: the legacy in-place
checkout stays frozen as the object source for future worktrees, the
release symlink takes the `app-live` sibling name, and the live `.env`
is re-pointed to it. Never pull the legacy path again. Roll back by
re-running `deploy.sh` from the older SHA (missing worktrees are
re-created from fetch); for an emergency manual rollback,
`ln -sfn <base>/app-<sha> <base>/app-live` under
`flock -x /tmp/baci-workers-deploy.lock`, then re-point the SHA marker
(`printf '<sha>' > $REMOTE_DIR/app-checkout.sha`) and delete the latch
(`rm -f $REMOTE_DIR/.gigl-capability-smoke-ok` — it certified the newer
revision, and without this a later non-tracking push would bypass on a
stale proof while cron runs the old code). Re-smoke afterwards for
immediate confidence; the next tracking push re-latches.

Known residual window: promote lands new code before the workflow's
`db-migrations` apply, so a tracking change that needs a new migration
fails its polls loudly (missing RPC) until migrations land, then heals.
No shipment state is processed ahead of its schema silently — the
claim call fails before any write. Moving the flip itself
post-migration (a workflow flip job) would close even the loud window
and is tracked as a follow-up, not this cutover.

## Scoped GIGL process environment

The shared worker `.env` holds every worker's secrets, but the
provider-facing GIGL poller and its capability smoke load only an
allowlist: the `GIGL_*` namespace (credentials plus present and future
knobs), `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `BACI_REPO_DIR`. In particular the
`SUPABASE_SERVICE_ROLE_KEY` and all other workers' credentials never
enter these processes, so code execution there cannot bypass the five
wrapper restrictions. Consequences:

- Runtime flags for the poller (if ever needed) must come from cron
  exports, not the shared `.env` — non-allowlisted file entries are
  invisible to it. A caller-exported value still wins over the file
  (dotenv precedence preserved).
- The VPS preflight still validates the FULL shared file (all workers'
  requirements); only the GIGL processes themselves are scoped.

## First rollout

Merging briefly freezes ALL production deploys (marker + latch both
fail) — this is announced and intentional:

1. Pull main on the deploy machine.
2. Run `bash vps-workers/deploy.sh` from a clean checkout (refuses
   dirty trees; deploys the merge commit). No VPS-side `git pull` is
   needed or wanted — `deploy.sh` provisions the immutable checkout
   itself; pulling the live path in place would run unverified code.
3. Re-run failed workflow jobs: readiness passes, migrations apply,
   the smoke writes the latch, the deploy lands.

Later tracking changes follow the same deploy.sh-then-rerun rhythm.
Web-only commits skip the exact-SHA/smoke verification once the latch
exists; the marker still passes on install presence.

## Stale-latch recovery

The latch records the revision of the last passing smoke. If tracking
changes land after that revision without a passing smoke (blocked
tracking push followed by web pushes), the gate keeps blocking web
pushes until the tree is re-smoked. Recover with `deploy.sh` from
current main, then either push any tracking change (its smoke
re-latches at HEAD) or dispatch the workflow (dispatch always runs the
full smoke live and re-latches on success).

## Re-enabling GIGL after a disabled period

A smoke that runs while `GIGL_ENABLED` is `0`/`false`/`off` writes a
DISABLED-scoped latch, which authorizes web pushes only while the worker
stays disabled. If a usable worker token is already provisioned, the
disabled smoke still probes the scope hook first (an already-issued JWT
stays usable while the grant is live, so the latch must not certify an
unreloaded hook); with no token it latches vacuously. The moment GIGL is
re-enabled, that latch stops validating (by design — a disabled run must
never certify enabled function), so the first non-tracking push after
re-enabling BLOCKS until a live smoke re-proves the token+hook.
Procedure:

1. Provision/verify `GIGL_TRACKING_WORKER_TOKEN` in the VPS `.env`
   (decode: `role` claim `gigl_tracking_worker`, ≥14 days runway),
   then set `GIGL_ENABLED=1` (or remove the override).
2. Run `bash vps-workers/deploy.sh` from current main.
3. Dispatch the deploy workflow (or push any tracking change) so the
   capability smoke runs live and writes an enabled latch.
4. Confirm the next web push deploys without a latch block.

Skipping step 3 leaves web deploys blocked with `tracking_stale=true`
until some smoke succeeds — that is the gate working, not a malfunction.

## Interim LOGIN password removal (one-time, post-merge)

Before this PR, production sat mid-rollout: the worker role was
LOGIN-capable with a password and the scope hook/isolate grant were not
yet applied. The merge's `db-migrations` closes that window
(`NOLOGIN` + `PASSWORD NULL` + hook installed and active in
`pg_db_role_setting` + grant, asserted by the least-privilege
final-state step on every run), which neuters the old credential — but
defense in depth says remove it anyway:

1. After the merge deploy lands green, delete the interim database
   credential from the VPS `.env` (no code in the tree reads a worker DB
   password — the poller authenticates by worker JWT — so the entry is
   vestigial; remove whichever key holds it).
2. Confirm final state once, directly:
   `SELECT rolcanlogin, rolpassword IS NOT NULL FROM pg_roles WHERE
   rolname = 'gigl_tracking_worker';` must return `f, f`.

## Break-glass (VPS runner down, cron uninstallable)

If the worker host or `baci-deploy` runner is down and an unrelated
production deploy cannot wait, there is no input flag or timer bypass
(by design — silent bypasses caused the holes this cutover closed).
The break-glass is an owner-approved emergency PR that temporarily
neutralizes the marker step and the latch term in
`.github/workflows/deploy.yml`, merged, deployed from, then REVERTED
immediately after. It reopens the cron-removal-without-worker hole for
exactly that window: only use it when tracking staleness is acceptable
(GIGL explicitly disabled, or the VPS outage already stopped polling),
and run `deploy.sh` + a tracking-push smoke at the earliest recovery
to re-prove function.
