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
   some smoke succeeds. The latch persists across `deploy.sh` promotes
   and never needs manual maintenance.

## First rollout

Merging briefly freezes ALL production deploys (marker + latch both
fail) — this is announced and intentional:

1. Pull main on the deploy machine.
2. Run `bash vps-workers/deploy.sh` from a clean checkout (refuses
   dirty trees; deploys the merge commit).
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
