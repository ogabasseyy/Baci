# Reviewed prefunded staging worker setup

Owner-executed successfully on 27 September; audit directory
`/root/baci-prefunded-workers.8DTV58ja`, marker `PREFUNDED_WORKERS_SCHEDULED`.
Independent read-only verification at 19:44 UTC confirms recurring successful
snapshot and background runs, both schedules, and both fixed deadline timers.
Do not rerun this installer, signed replay/enrollment, or credential preparation.

## Completed Mac command (do not rerun)

```sh
/bin/sh /Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/prefunded-card/activation-workers.sh
```

This permanent launcher opens SSH and prompts for the owner's sudo password.
It embeds a literal reviewed bootstrap checksum, rather than trusting a mutable
remote command file. Bundle: `/home/bassey/baci-prefunded-workers-20260927`.

- Runner: `1b59f6c586df2e99448699804707821a7c761de5f1232de8a27128bc5bc6f6fd`
- Checksum list: `9eac0cd49d979050dd9e5c235e2631a0abdb2c1e97cf5a3d02b922487d2a7ee2`
- Background: `3619c9b637ab4d60e7379c5d2d902fa273e93e86b42ff1ce67481800a5409ec3`
- Snapshot: `e702ff351f938958e6b8fd271deabc212cea0d92c9b3db283b64415322942355`
- Readiness: `1900adbea9de109b17638dc13915a7c24f3b867d3d756b84a2597e1466beae82`

## What it does

1. Verify sealed files, exact existing private-configuration hashes, fresh signed
   replay heartbeat, fixed database identity and current enrollment/history.
   Rehearse the guarded checkout SQL delta inside a transaction ending in rollback.
2. Install immutable compiled code, separate read-only credential mounts, and
   nonroot, portless containers. The snapshot verifier has its own restricted
   database credential; the dispatcher never receives that credential.
3. Prove the three restricted TLS executors; install exact systemd service/timer
   units without drop-ins or boot enablement. Install a stopper for the unchanged
   **29 September 2026, 15:59:10 UTC** deadline.
4. Atomically update only the pinned checkout capability/promotion definitions,
   preserving function identity, ownership and grants. Unknown baselines, new
   financial operations, changed history or treasury state refuse.
5. Run the actual scheduled snapshot service, then the actual scheduled combined
   recovery/dispatcher service. Require fresh successful invocations and exact
   completion reports, then verify zero payment operations/intents, unchanged
   NGN100 principal and zero treasury reservation/consumption.
6. Schedule the independent verifier every five minutes and combined worker
   thirty seconds after each completed invocation. No second recovery runner is
   scheduled. Container and systemd timeouts bound each background invocation.
   Busy or incomplete passes do not count as successful scheduled work.

Expected marker: `PREFUNDED_WORKERS_SCHEDULED`. This installs processing for the
approved 10,000-kobo company sandbox budget. **It does not enable public card
checkout, authorize a saved-card debit, charge a card, or change production.**
The initial passes must contain no payment work. Once a later public gate creates
an approved intent, the scheduled dispatcher can execute that bounded operation.

## Failure and recovery

No files or containers are deleted to force installation. Differing existing
files, containers or units refuse; root audit output is retained. SQL commit
uncertainty is reported explicitly, not treated as rollback. A failure after
scheduling withdraws only these two schedules/services; signed replay and other
services remain untouched. No lease extension or credential rotation occurs.
Do not rerun blindly after financial activity or an unknown commit.

## Validation and remaining gate

- 33 focused Python/scratch-PostgreSQL/launcher tests and 29 runtime tests pass. The
  pre-dispatch configuration bug was reproduced before fixing the raw-input
  boundary; strict schemas remain unchanged.
- Luna corrected a stale phone test expectation and added first-card launch,
  10,000-kobo-limit and disabled-capability checks: 59 tests pass, no UI production
  code or gating changed. Parent reviewed that bounded patch.
- All six monorepo typecheck tasks pass. Existing unrelated mobile lint failures
  remain. The full run passes all 1,257 mobile suites (7,358 tests), but unrelated
  web history/materialization, Cloudflare process-isolation and analytics boundary
  tests fail. The remaining broad run was stopped after those failures (five
  Turbo tasks completed, web unfinished); logs remain at
  `/private/tmp/baci-workers-full-tests.log`. No all-green monorepo claim is made.
  Root CodeRabbit review exceeds its 150-file limit; narrower untracked
  tooling review skips with no changes detected, so it is not an independent pass.
- Luna and Terra reviewed their bounded lanes; parent addressed the replay-health
  and scheduled-completion findings with regression coverage. All 195 compiled
  input digests match current source.
- Read-only `systemd-analyze verify` on the VPS accepts all six proposed units
  (exit zero). Permission warnings concern unrelated existing Ollama units.
  No unit was installed, started or enabled by this check. The owner installer
  still must prove execution under the actual scheduled units.

Independent database verification confirms all five desired function digests and
original OIDs, one credit route, zero operations/intents, NGN100 goal principal,
and 10,000 kobo company budget with zero reserved/consumed. The latest independently
recorded provider snapshot has 10,000 kobo available (sequence 5, 19:44:18 UTC).
Snapshot and background services are successful **oneshots**: inactive/exited-zero
between timer invocations is expected, not a failed daemon. Replay remains running
with a completed-pass heartbeat. These are readiness checks, not a financial test.

Next deploy and verify authenticated first-card checkout through the phone origin.
The actual phone test must still prove card collection, company-wallet transfer,
an original signed provider receipt, exactly-once recognition and updated balance.
Neither an empty worker pass nor a browser callback proves financial completion.
