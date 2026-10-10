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
deploy cycle — reconcile instead.
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
  default branch re-validates the operational branch's full history on a
  15-minute schedule as the backstop (a `push` trigger cannot work: GitHub
  sources push workflows from the pushed ref, which never contains CI files).

## Sources

- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments
- https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency
- https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel

GitHub concurrency does not automatically serialize other workflows merely
because they share an environment. All production entry points must participate
in the same coordination protocol. Keep cancel-in-progress disabled across mutations.
