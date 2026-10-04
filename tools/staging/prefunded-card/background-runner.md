# Staging first-card background orchestration

Use `background-runner.sh` as the single scheduled one-shot entrypoint. It
holds the same private FD9 `flock` used by the checkout recovery runner, so the
two commands cannot overlap. Do not schedule the recovery-only wrapper beside
this orchestrator. One invocation performs at most one bounded checkout
recovery pass and calls the existing `composition.tick()` once only after that
pass completes. The dispatcher result and all thrown errors are redacted.
Dispatch totals are checked against the worker's batch limit and claim outcome
semantics before a pass can report completion.

The CLI reads `/etc/baci-staging/prefunded-first-card.json` through the existing
owner-only file reader. That strict configuration pins staging origins,
database project, physical system identifier `7685292944002592802`, and expiry
`2026-09-29T15:59:10Z`. Recovery cursor state remains in
`/var/lib/baci-staging/prefunded-first-card` (mode `0700`); the shared lock file
is mode `0600`. The runner reserves at most 240 seconds for recovery and
requires at least 240 seconds of its 480-second overall budget before it starts
dispatch. Configure the staging service with a hard runtime timeout of at most
480 seconds; that timeout supplements the runner's own pre-dispatch and
post-dispatch clock guards.

This adds the caller, not an installed scheduler or active runtime. The owner
must provision the restricted LOGIN executor credentials, install the private
activation file and state directory, and schedule only this entrypoint. The
existing PostgreSQL TLS endpoint uses the owner-provided CA at
`/etc/baci/piggyvest-staging/postgres-ca.pem` and the private hostname
`piggyvest-db.staging.baci.internal`; no TLS installation is part of this
runner. Treasury reservation readiness also requires a separately scheduled
verifier to publish an independently verified snapshot less than 15 minutes
old. The worker must not attest to that snapshot or replenish it automatically.

The foundation, restricted LOGIN/TLS roles, treasury binding, evidence authority,
and signed replay/enrollment are now owner-installed. The migrated goal retains
10,000 kobo; card operations/intents and treasury reservations/consumption remain
zero. The independent snapshot schedule, this background schedule, checkout SQL
delta and public first-card route are still pending. The worker installer stages
a compiled version of this same wrapper (private FD9 lock retained; no runtime
package manager), with separate nonroot verifier/dispatcher containers and the
unchanged fixed deadline. See `runtime-workers-owner.md` for the current gate.

The CLI now passes the validated original background input to the composition
factory. Passing already-transformed executor profiles back into its strict
input schema was a real pre-dispatch failure; a configuration-boundary regression
failed against that code and passes with the source handoff. No schema was relaxed.
