# GIGL tracking cutover runbook

The Vercel `*/5` tracking cron is removed; the VPS direct worker is the
only poller. Three gates protect the cutover, in run order:

1. **Cutover marker** (readiness, every main push): worker files +
   well-formed SHA + canonical crontab installed. Fails until
   `deploy.sh` has run at least once post-merge.
2. **Exact-SHA + capability smoke** (tracking changesets only):
   worker checkout equals the pushed commit; live token+hook+provider
   verification after migrations.
3. **Cutover latch** (gate bypass for tracking=false pushes):
   `.gigl-capability-smoke-ok` on the worker host, written only by a
   passing smoke. Install presence alone cannot prove the worker
   FUNCTIONS, so web pushes stay blocked after a smoke failure until
   some smoke succeeds. The latch records `<scope>:<sha>:<fingerprint>`
   for the environment the smoke observed and is re-validated on every
   read: the installed SHA, the enablement scope, and the proven token
   fingerprint must all still match, or the bypass closes until
   re-smoked. The bypass additionally requires `manifest_drift ==
   'false'`: the installed dependency manifests must match HEAD, or a
   manifest-only push blocks until `deploy.sh` converges (see
   "Manifest-only drift triage" below). Fingerprint binding is scope-agnostic: a disabled latch
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
re-created from fetch; refuses while a production deploy is in flight
unless `BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1` — emergency only, then
re-run the smoke/latch sequence). For an emergency manual rollback,
restore the COMPLETE old worker release — not just the checkout
symlink: repointing `app-live` alone leaves the newer `bin/`, `jobs/`,
`lib/`, `config/`, `node_modules/`, and crontab installed, so cron
executes a mixed release while the SHA marker claims the old
revision, and neither readiness nor the latch can detect the
wrapper, dependency, config, or schedule skew. The old worktree is a full repo checkout, so it
carries the old `vps-workers/` tree; if it was already retired,
re-create it first (`git -C <base>/app-live worktree add --detach
<base>/app-<sha> <sha>`), or use the `deploy.sh` path instead.

Rebuild the old dependency trees BEFORE taking locks: a registry
fetch under the quiesce would hold every worker lock for the whole
install, while the retired worktree runs nothing until the flip, so
building there is contention-free (node_modules/ is git-ignored, so
the "immutable" worktree stays git-clean — provision does the same
`pnpm install` inside per-SHA worktrees). Both trees: the
`vps-workers` prod tree synced to `$REMOTE_DIR/node_modules`, AND the
app-checkout tree the restored wrappers execute (a re-created
worktree has no `tsx`, so without this the poller fails with
"Missing executable tsx" right after the flip):

```sh
(cd <base>/app-<sha>/vps-workers && CI=true pnpm install --frozen-lockfile --prod)
if [ ! -x <base>/app-<sha>/apps/web/node_modules/.bin/tsx ] && [ ! -x <base>/app-<sha>/node_modules/.bin/tsx ]; then
  (cd <base>/app-<sha> && CI=true PUPPETEER_SKIP_DOWNLOAD=1 pnpm install --frozen-lockfile)
  printf '%s\n' "<sha>" > <base>/app-<sha>/node_modules/.baci-deps-installed
fi
```

Render the target revision's crontab fragment BEFORE taking locks
(pure computation, contention-free): the old worktree carries the
old `deploy.sh`, whose unquoted heredoc expands these same variables
at deploy time — replicate exactly, then refuse unexpanded lines:

```sh
old_deploy=<base>/app-<sha>/vps-workers/deploy.sh
eval "$(grep -E '^CRON_BLOCK_(START|END)=' "$old_deploy")"
node_bin=$(command -v node || echo /usr/bin/node)
codex_bin=$(find /home/bassey/.local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor -path '*/bin/codex' -type f -print -quit)
[ -n "$codex_bin" ] || { echo "Cannot resolve the native Codex binary; aborting." >&2; exit 1; }
{
  echo "REMOTE_DIR='$REMOTE_DIR'"
  echo "NODE_BIN='$node_bin'"
  echo "CODEX_REMEDIATOR_IMAGE='baci-codex-remediator:<sha>'"
  echo "CODEX_CONTAINER_BIN='$codex_bin'"
  echo "CODEX_READONLY_SECCOMP_PROFILE='$REMOTE_DIR/config/codex-readonly-seccomp.json'"
  echo "CRON_BLOCK_START='$CRON_BLOCK_START'"
  echo "CRON_BLOCK_END='$CRON_BLOCK_END'"
  echo 'cat <<EOF'
  sed -n '/^\$CRON_BLOCK_START$/,/^\$CRON_BLOCK_END$/p' "$old_deploy"
  echo 'EOF'
} > /tmp/baci-old-cron-render.sh
bash /tmp/baci-old-cron-render.sh > "$REMOTE_DIR/crontab.fragment.rollback"
! grep -E '\$[A-Za-z_]' "$REMOTE_DIR/crontab.fragment.rollback"
```

(The remediator image tag is the target SHA: it exists if the old
deploy's image was never pruned. If it was, rebuild it or take the
`deploy.sh` path instead of this manual procedure.)

Refuse the rollback while a production deploy is in flight, through
the same GitHub-side protocol as `deploy.sh` — run from a checkout
of the production repo with an authenticated `gh` (the `bash -c`
wrapper keeps the sourced functions out of the interactive shell and
propagates the refusal status; the functions return, never exit, so
even a direct source cannot kill the operator shell; emergency-only
bypass `BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1`, then re-verify the latch):

```sh
bash -c '. vps-workers/lib/check-deploy-workflow-inflight.sh && check_deploy_workflow_inflight'
```

Then, under the deploy lock with the GIGL runtime lock nested inside
(promote's order), quiesce EVERY worker via the shared helper before
touching the shared trees — this restore replaces `bin/`/`jobs/`/`lib/`
for all workers, not just GIGL, so a non-GIGL tick that lands mid-restore
would otherwise run mixed-release code:

```sh
flock -x /tmp/baci-workers-deploy.lock \
flock -x "$REMOTE_DIR/locks/gigl-tracking.lock" bash -c '
  set -euo pipefail
  # The remote dir arrives as $0 (the trailing argument), NOT via
  # $REMOTE_DIR: this child shell only inherits EXPORTED variables,
  # and an operator who set REMOTE_DIR without export would trip
  # `set -u` on the first inner reference.
  remote_dir="$0"
  # Full quiesce (same helper as promote): stops the persistent
  # services (auto-restarted on shell exit, even on abort) and holds
  # every scheduled worker lock, so other ticks skip instead of
  # straddling. Sourced from LIVE (the revision actually running). If
  # the helper itself is absent, lib/ is destroyed and the other
  # workers are already down — proceed with the two locks.
  if [ -f "$remote_dir/lib/quiesce-worker-release.sh" ]; then
    . "$remote_dir/lib/quiesce-worker-release.sh"
    quiesce_worker_release "$remote_dir" || exit 1
  else
    echo "WARNING: quiesce helper missing; continuing with deploy+GIGL locks only." >&2
  fi
  rsync -a --delete <base>/app-<sha>/vps-workers/bin/ "$remote_dir/bin/"
  rsync -a --delete <base>/app-<sha>/vps-workers/jobs/ "$remote_dir/jobs/"
  rsync -a --delete <base>/app-<sha>/vps-workers/lib/ "$remote_dir/lib/"
  # Runtime config (seccomp profile): the restored crontab passes the
  # live config path to the old release, so a newer policy must not
  # survive under old code. Guarded for rollback targets that predate
  # config/ (then old code cannot reference it either).
  if [ -d <base>/app-<sha>/vps-workers/config ]; then
    rsync -a --delete <base>/app-<sha>/vps-workers/config/ "$remote_dir/config/"
  fi
  rsync -a --delete <base>/app-<sha>/vps-workers/node_modules/ "$remote_dir/node_modules/"
  # The dotenv reader ships with this cutover: targets that predate it
  # have no copy to restore (and their old lib/ cannot reference it
  # either — the reader did not exist), so copy only when the target
  # carries it. An unconditional copy aborts mid-rollback under set -e,
  # after the trees are synced but before crontab, symlink, SHA marker,
  # and latch converge, and the quiesce trap then restarts services
  # against that mixed release.
  if [ -f <base>/app-<sha>/.github/scripts/gigl-dotenv.sh ]; then
    cp <base>/app-<sha>/.github/scripts/gigl-dotenv.sh "$remote_dir/bin/gigl-dotenv.sh"
  fi
  # Restore the target revision's crontab while ticks are still
  # blocked: the merge is the old rev's own script (anchor-extracted,
  # so deploy.sh rev skew cannot desync it), run against the
  # pre-rendered old fragment — the same idempotent splice as
  # deploy.sh (block replace plus stray-line cleanup). Markers come
  # from the fragment's own first/last lines (the template expands
  # them), so no marker values cross the shell boundary.
  sed -n "/<<'REMOTE_SH'/,/^REMOTE_SH\$/p" <base>/app-<sha>/vps-workers/deploy.sh | sed '1d;$d' > /tmp/baci-old-cron-merge.sh
  bash /tmp/baci-old-cron-merge.sh "$remote_dir/crontab.fragment.rollback" "$remote_dir" "$(head -n 1 "$remote_dir/crontab.fragment.rollback")" "$(tail -n 1 "$remote_dir/crontab.fragment.rollback")"
  ln -sfn <base>/app-<sha> <base>/app-live
  printf "<sha>" > "$remote_dir/app-checkout.sha"
  rm -f "$remote_dir/.gigl-capability-smoke-ok"
' "$REMOTE_DIR"
```

Files (including the rebuilt dependency trees and the restored
schedule) converge BEFORE the symlink/marker flip, so the marker
never claims the old revision while newer wrappers are still
installed. Every step is idempotent: re-running the block after a
failure is safe, except the merge consumes the fragment — re-render
it first if re-running past that point. Deleting the latch is
required — it certified the newer revision, and without this a later
non-tracking push would bypass on a stale proof while cron runs the
old code. Record the rollback afterwards so the workflow's
pre-publish overlap check sees it (same record as a promote, with
the restored full 40-hex SHA — a deploy that started after the
pre-rollback check reads post-rollback files and needs no warning,
but one that was already in flight must refuse to publish off its
pre-rollback latch/SHA read):

```sh
bash -c '. vps-workers/lib/check-deploy-workflow-inflight.sh && record_deploy_workflow_promote "<full-sha>"'
```

Re-smoke afterwards for immediate confidence; the next tracking push
re-latches. Follow with a full `deploy.sh` from the old SHA at the
first opportunity anyway: it re-converges the user services and the
remediation transition, which this file-and-schedule restore does
not touch.

Known residual window: promote lands new code before the workflow's
`db-migrations` apply, so a tracking change that needs a new migration
fails its polls loudly (missing RPC) until migrations land, then heals.
No shipment state is processed ahead of its schema silently — the
claim call fails before any write. Moving the flip itself
post-migration (a workflow flip job) would close even the loud window
and is tracked as a follow-up, not this cutover.

## deploy.sh / workflow serialization

Manual promotion (including the emergency manual rollback above,
which runs the same check-before/record-after steps) and the
production deploy workflow are mutually exclusive across the GitHub
API, in both directions:

- `deploy.sh` refuses to promote while any main-branch deploy run is
  in flight (checked before staging for fail-fast, and again after
  the image build, before the cron transition mutates live schedule —
  a refusal there leaves live cron untouched). Override: set
  `BACI_DEPLOY_WORKFLOW_REPO=owner/repo` when origin is unresolvable,
  or `BACI_DEPLOY_SKIP_INFLIGHT_CHECK=1` in an emergency (then re-run
  the smoke/latch sequence and confirm the published revision).
- Every promote records `<sha>:<in-flight-run-ids>` in the
  `ops/gigl-promote-record` branch (single file
  `.gigl-promote-record`, created automatically on first promote;
  `[skip ci]` commits). The workflow's last pre-publish step reads
  that file live and refuses to publish when its own run id is in
  the record — so even a run that was invisible to the pre-promote
  query cannot publish off a stale latch/SHA read. Recovery is
  re-running the workflow off fresh reads; run ids (not timestamps)
  mean the record never goes stale. The store is a branch (not an
  Actions variable) because `GITHUB_TOKEN` cannot be granted the
  Variables permission; the contents read works under the publish
  job's existing `contents:read`.

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
   the smoke writes the latch, the deploy lands. Migration apply is
   split around a hook-reload probe: if the `Probe GIGL hook reload
   acknowledgement` step fails, PostgREST never served a unanimous
   window of the hook's reload canary (either nothing acked, or a stale
   replica kept answering) and the isolate grant is NOT applied — check
   PostgREST fleet health/config reload, then re-run the deploy (the
   probe skips fast once the isolate migration is recorded; never grant
   the membership by hand to clear it).

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

## Manifest-only drift triage (worker-stale-first)

The monorepo manifests are deliberately outside the tracking smoke
(see `.github/filters/deploy.yml`), but drift is ENFORCED: the latch
check diffs the installed tree against HEAD over the manifests group,
and the bypass term requires `manifest_drift == 'false'`. A
manifest-only push therefore blocks the bypass (with a CI warning
explaining the skip) until `deploy.sh` from current main converges
the worker — plus a tracking push or dispatch to re-smoke, since the
converge promote moves the installed SHA and invalidates the latch
binding until the new tree is re-proven. For a time-sensitive
dependency fix (transitive security patch the poller executes), run
that sequence immediately after the merge instead of waiting. And one
on-call rule survives the enforcement: **a manifest-only push
followed by a VPS incident still triages as worker-stale-first** —
confirm with the installed SHA (`cat
$REMOTE_DIR/app-checkout.sha`) versus HEAD, then converge.

## Poller dead-man signals (no pager)

A failing poller pages nobody: the `*/5` cron appends to a persistent
VPS log, the poller redacts provider/customer/database detail by
design, and no pager transport is wired yet. Until one is, confirm
poller liveness manually with these three signals (in order):

1. **Cron log tail** — `tail -n 50 $REMOTE_DIR/logs/gigl-tracking.log`:
   look for `[gigl-tracking] failed` lines and check the last lines
   are minutes old. The log is redacted by construction, so it proves
   liveness, not cause.
2. **Due-but-unpolled backlog** — a healthy poller claims due rows
   every 5 minutes, so rows due >15 minutes ago mean missed cycles:
   `SELECT count(*) FROM public.shipment_tracking_monitors WHERE state
   IN ('active', 'final_poll', 'paused') AND next_poll_at IS NOT NULL AND
   next_poll_at < now() - interval '15 minutes';`
   (`paused` rows re-enter the claim set once `next_poll_at` is due,
   and pausing clears `locked_at`, so omitting them blinds this
   signal exactly when a cooldown backlog is stuck.)
3. **Stuck claims / repeated failures** — crashed mid-batch, or
   provider/auth breakage:
   `SELECT count(*) FROM public.shipment_tracking_monitors WHERE
   locked_at IS NOT NULL AND locked_at < now() - interval '30
   minutes';`
   `SELECT count(*) FROM public.shipment_tracking_monitors WHERE state
   IN ('active', 'final_poll') AND consecutive_failures > 3;`

The latch mtime (`stat $REMOTE_DIR/.gigl-capability-smoke-ok`) is NOT
a liveness signal — it records the last passing smoke, and goes stale
by design between tracking pushes. If the signals above show a dead
poller, fix forward with `deploy.sh` from current main (which
re-smokes the candidate) rather than hand-editing the live tree.

## Re-enabling GIGL after a disabled period

A smoke that runs while `GIGL_ENABLED` is `0`/`false`/`off` writes a
DISABLED-scoped latch, which authorizes web pushes only while the worker
stays disabled. If a usable worker token is already provisioned, the
disabled smoke still probes the scope hook first (an already-issued JWT
stays usable while the grant is live, so the latch must not certify an
unreloaded hook); with no token it latches vacuously. The moment GIGL is
re-enabled, that latch stops validating (by design — a disabled run must
never certify enabled function), so the first non-tracking push after
re-enabling BLOCKS until a live smoke re-proves the token+hook+provider.
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
