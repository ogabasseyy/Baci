# Production release coordination

> **Draft only:** automatic coordination is not active. The implementation in
> this worktree is blocked on isolating the runner's persisted GitHub
> credential from same-user worker installation code. See
> `docs/superpowers/plans/2026-10-28-auto-worker-release.md` before treating
> these procedures as current.

## Operator entry point

Normal pushes to `main` now enter `.github/workflows/production-release.yml`. To
start a manual release, dispatch **Production Release Coordinator** on `main`
from GitHub Actions. `deploy.yml` is callable only by that workflow; direct
pushes and workflow dispatches to it are no longer release entry points.

The coordinator serializes releases with a shared GitHub concurrency group, checks
out the triggering SHA, acquires a durable host lock, updates and verifies the
workers, then calls `deploy.yml` within the same workflow run. The app workflow
keeps its migration ordering, production environment, GIGL capability checks,
prebuilt Vercel publication, overlap barrier, retry behavior, and post-deploy
checks. It now checks the exact worker SHA on every app publication and verifies
that the live alias serves the expected project, READY production deployment,
and current main SHA before clearing the host lock.

GitHub Actions OIDC is the only same-run worker exemption. The verifier checks
the signed token's issuer, audience, repository ID, workflow path, ref, SHA,
event, run attempt, and check-run ID, then joins that job to the GitHub Actions
API and verifies the workflow, in-progress status, `baci-deploy` runner label,
and live `main` SHA. A standalone `deploy.sh` call cannot forge this exemption.
The worker job receives only Actions read, contents write for the existing
promotion record, and the OIDC mint permission. Vercel and Supabase secrets stay
in the app workflow. The Production environment configuration is unchanged.

## Durable lock and recovery

The lock is `/home/bassey/.local/state/baci/pending-production-release.json` on
the verified `ogabassey` host as UID 1001. It binds the workflow run, attempt,
and SHA. It is created before worker promotion and remains after any failure,
cancellation, main movement, unreadable API response, failed post-publish check,
or uncertain publication. The next run fails closed while it exists. The lock is
cleared automatically only when the reusable app workflow reports that the
publication job was skipped, or verifies worker SHA, current main, project
identity, live alias stability, READY state, and exact deployed SHA.

Do not delete a retained lock based only on a failed workflow summary. Reconcile
all attempts of the owning workflow, confirm no worker or app deployment remains
active, verify the installed worker SHA, and inspect the live Vercel alias and
deployment. If publication may have occurred, resolve it to an exact verified
serving SHA first. Only then may an operator remove the lock on the verified host
and re-dispatch the current `main` tip. No emergency environment flag skips the
in-flight, record, or barrier checks. The promotion record and crash barriers
remain independent protections and still require their existing reconciliation.

The behind-base hook now validates ops/gigl-promote-record as an operational tree
instead of comparing its separate history with main. It permits only one valid
record plus validated barrier blobs, rejects application files, executable files,
symlinks, malformed records and non-fast-forward updates, and leaves the other
pre-push checks in place. Deploy only after this hook change is merged and present
in the clean release checkout; do not disable global hooks to make an old checkout pass.

## Safety and evidence

- Preserve the worker capability smoke, immutable checkout, cron quiescence,
  promotion records, deployment locks, migration ordering and rollback paths.
- A successful workflow is insufficient if its publishing job was skipped.
- A latest deployment listing is insufficient: resolve the actual production alias.
- Restrict retries to demonstrably idempotent steps; reconcile ambiguous outcomes.
- Keep provider issuer evidence, commercial terms, campaign activation and real
  payments explicitly controlled. Infrastructure automation cannot invent them.
- Test stale commits, concurrent releases, worker failure, main advancement,
  dispatch ambiguity, skipped publishing and stale/wrong-project live aliases.
- Create ops/gigl-promote-record orphan: a new branch validates its full
  reachable history, so non-orphan creation from unrelated history is refused.
- The pre-push hook is client-side and bypassable (`--no-verify`); the
  default branch re-validates the operational branch from the last
  validated tip on a 15-minute schedule as the backstop (a `push` trigger
  cannot work: GitHub sources push workflows from the pushed ref, which
  never contains CI files). Validating from the cached tip enforces
  fast-forward, so force-push rewrites fail even when every rewritten
  tree is shape-valid. A cache miss fails closed without re-seeding
  (recover via manual dispatch with confirm_reseed after out-of-band
  verification), so an eviction can never launder a rewrite.

## Sources

- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments
- https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency
- https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel

GitHub concurrency does not automatically serialize other workflows merely
because they share an environment. All production entry points must participate
in the same coordination protocol. Keep cancel-in-progress disabled across mutations.

## Checkout-shipping recovery activation and rollback floor

The initial eleven recovery migrations form one atomic group in the production
migration applier: RPC creation, grants, later guards and the closed activation
row become visible together. Before any migration mutation, the applier requires either the entire group
pending or the entire group already applied, verifies recorded identities and
refuses incomplete group files. Stop and reconcile partial history before release.
The only supported predecessor upgrade is an explicitly approved coordinated
release with all ten original recovery migrations applied under their exact
identities, all eleven source files present, no activation table/history row,
and no saved recovery previews. On a manual **Production Release Coordinator**
dispatch, set `reconcile_checkout_recovery_legacy` only after verifying those
preconditions. This approval reaches the migration job only on a coordinated
manual dispatch; ordinary main pushes keep the partial-history rejection. Capped passes
defer the gate upgrade while still applying migrations at or below the cap so the
existing hook probes can complete. The uncapped pass installs only the new closed
gate before any remaining pending migration. Its
transaction locks and rechecks the migration identities and empty preview table;
changed history, an existing gate, or saved previews aborts the repair. Do not
clear previews or modify orders to make that check pass. Any other partial state
needs separate investigation. This upgrade does not retroactively make the ten
previously applied migrations atomic or prove that recovery was never used.

The recovery activation migration defaults the private release row to disabled.
Context and preparation, and every first confirmation, enforce it inside the
shared database assertion. Application UI state cannot enable it. Confirmed
idempotent acknowledgments remain read-only and keep their existing actor and
selected-quote checks. Disabling the row waits for in-flight recovery
transactions holding its shared lock.
The preview insert/confirmation trigger independently enforces the gate for
older calls that already passed the previous assertion. A rejected confirmation
rolls back its entire transaction; confirmed audit redaction remains available
while the gate is closed.

Run the existing coordinator from clean current main with the approved flags.
Keep recovery disabled while its migrations, worker capability smoke, app
publication, serving alias and health checks run. Complete Android recovery QA
against approved isolated fixtures before activation. Do not publish the mobile
feature or call live carrier booking as a substitute for QA.

The first successfully verified coordinated deployment establishes the new
compatible rollback floor: its commit must contain the reviewed complete-original
or complete-surviving domestic quote validation, shipment mapping, and passing
refund/package regressions. Resolve the actual `ogabassey.com` production alias
and verify READY, expected project and exact commit; record that immutable
production deployment ID and commit as the compatible artifact. Keep it retained
and available for production rollback. The pre-recovery deployment
`32e893bf99bb8060e55e7440d3288418efa43189` is incompatible after recovery writes
and must not be used; the activation table independently rejects that known SHA.

Only after all these checks, the release operator may use the approved database
connection to update the single operational row, with the verified values:

```sql
BEGIN;
UPDATE private.checkout_shipping_recovery_release_activation
SET enabled = true,
    rollback_deployment_id = '<verified production deployment ID>',
    rollback_commit_sha = '<verified compatible commit SHA>',
    verified_at = now()
WHERE singleton IS TRUE AND enabled IS FALSE
RETURNING enabled, rollback_deployment_id, rollback_commit_sha, verified_at;
COMMIT;
```

The placeholders must be replaced with live verified metadata. Require exactly
one returned row, then read the row back. A missing or already-enabled row needs
reconciliation, not an unguarded retry. This is release configuration, not order
data; no production order, quote, funding or refund is manually edited. The
activation row has RLS and no client or service-role table privileges.

To stop new recovery writes during an incident, the operator may set only
`enabled = false` on this singleton row and verify it. This does not undo saved
quotes, change fees, book shipments, or make the old incompatible deployment safe
to restore. Use only a compatible retained artifact for application rollback.
