# Production release coordination

## Operator entry point

After this change is reviewed and merged, use a clean checkout of current main:

```sh
node .github/scripts/release-production.mjs --approve-production --approve-prebuilt-fallback
```

This replaces the manual worker-update, verification, dispatch, workflow-watch,
and live-alias verification sequence. It does not activate REDVAULT or send payments.
The fallback flag approves the existing GitHub-hosted prebuilt application build,
not a Vercel cloud build.

The coordinator requires authenticated GitHub and Vercel CLIs, working SSH access
to the approved VPS, and the existing worker deployment prerequisites. The Vercel
CLI must be >= 50.5.1, the first release shipping `vercel api` for live-alias
verification; older CLIs are refused before dispatching. It refuses
dirty or stale checkouts and concurrent deployments, rechecks main after worker
preparation, verifies the dispatched SHA, rejects skipped publication, and checks
the serving Vercel alias against the expected project, production state and SHA.
It does not retry indeterminate dispatches or remove production overlap barriers.
If it crashes or reports an indeterminate dispatch, reconcile the existing release before removing its local lock.

## Unattended integration boundary

This entry point is not an installed automatic-on-merge workflow. Do not invoke it
inside deploy.yml: the worker script correctly rejects an in-flight publishing run.
Before unattended integration, move release initiation into one outer coordinator,
disable competing push publication, and retain manual dispatch as a coordinated
operator path. Until then the guarantees in this document (SHA pinning,
dispatch correlation, skipped-publication rejection, live-alias checks)
apply to coordinator-driven workflow_dispatch releases only;
push-to-main publication keeps its existing uncoordinated path.
A push deploy interleaving a coordinated release is a known residual
race: it publishes outside the sibling check, and the trailing
live-alias verification fails the coordinator run without preventing
the extra publication. The coordinator identifiers correlate a
coordinator run with its dispatch; they are not authorization —
anyone with workflow_dispatch permission and the right SHA passes
the gate, so keep dispatch permission tightly scoped. Do not
double-run the entry point for an already-released commit: republication
is content-identical and passes verification, at the cost of a wasted
deploy cycle — reconcile instead. Never run two coordinators concurrently
(even on different machines): the lock is local-only and the sibling
abort is best-effort, so concurrent runs are procedurally forbidden,
not just detected. Freeze main pushes for the duration of a coordinated
release: push deploys bypass the sibling check and can only be caught
after the fact by live-alias verification.
Provision restricted runner authentication and trusted VPS access
without copying personal SSH keys or introducing a broad permanent token.

The current VPS cannot SSH to its own deployment endpoint and has no gh CLI on its
normal PATH. Those prerequisites must be deliberately provisioned before choosing
it as the unattended coordinator runner. No dedicated deployment SSH credential
was found in repository Actions secret names; the iOS signing key is not a release
credential and must not be repurposed.

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
and no saved recovery previews. Use:

```sh
node .github/scripts/release-production.mjs --approve-production --approve-prebuilt-fallback --approve-recovery-gate-reconciliation
```

This optional approval reaches the migration job only on a coordinated manual
dispatch; ordinary main pushes keep the partial-history rejection. Capped passes
defer every migration write until the existing hook probes complete. The uncapped
pass installs only the new closed gate before any other pending migration. Its
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
