# Prepared existing-payment-only continuation

## October 3 live completion

The corrected sealed release
`b236f0d961601aa0b7b305605c2554f42c241180a86de733cc6b078240a54613`
completed live from `/root/baci-existing-continuation-r2.w2fa2hp8` after a
successful independently compared read-only preflight. COMMIT was acknowledged,
cleanup confirmed, and independent physical reconciliation verified completion.
Do not rerun the continuation or start another payment for this operation.

A separate read-only query confirmed the new plan principal is ₦100 and the
original plan still holds ₦100. The operation projection is `applied`, collection
and transfer remain `verified_success`, and treasury consumption is unchanged at
10,000 kobo with zero reserved. The existing reminder remains alongside exactly
one `first_contribution` notification (`ad00ea01-65f0-4594-b4f9-71cb609c6aaa`).
No new charge, transfer, replay restart or public-runtime restart occurred.
An application event is not proof of phone push delivery or screen acceptance.

### Separate phone-origin acceptance

Fresh authentication against the pinned staging profile subsequently confirmed
both plans return `currentAmount: 100` through the phone-origin goals API.
The notifications API returned HTTP 200 with nine unread notifications,
including the exact first-contribution event above and the preserved reminder
`914e9941-c9c1-44a1-9879-1de3e54ac365`. These password grants are separate Auth
acceptance activity, not an unchanged precredit Auth snapshot.

Read-only delivery inspection found zero delivery rows for that contribution
and zero active storefront push tokens for the staging actor. Inbox
`deliveryEnabled: true` therefore does not establish push delivery. The public
checkout container, signed replay and ordinary notification timer remain stopped;
the notification role and deadline timer expire October 6 at 15:59:10 UTC.
The old notification renewal installer is not a resume command for the now-funded
second goal. Native staging push identity/build and physical-device acceptance
remain separate gates. No new payment or financial mutation was made by these
acceptance reads.

The preparation notes below describe the source contracts and earlier status.

These sources do not constitute a sealed or authorized live package. No repair,
projection, service activation or provider request was executed while preparing
them. The ledger repair remains separately approval-gated.

`continuation_release.py` is a stdlib-only bootstrap. It authenticates the complete
flat package before executing any dependency bytes: exact manifest kind, fixed
operation/deadline, exact file set, SHA-256, root-owned 0600 single-link regular
files, no-follow stable descriptors and root-owned nonwritable ancestors.
Modules are executed from those captured bytes, not pycache or ambient imports.
Existing application modules with the same names are refused. Source closure and
module origins are rechecked at each boundary.

`continuation_runner.py` uses only the fixed application database/psql command.
One READ COMMITTED connection performs the source-pinned singleton admission,
claim, projection, finish and restricted-role deferred constraint validation.
It assembles truthful precommit evidence from the existing pinned collectors and
uses `projection_fence` before the separate COMMIT call. It never changes checker
authority, collects money, transfers money, resets a queue manually or restarts
the preserved failed worker. Expired queue claims are handled by the existing
`claim_due`, not by an out-of-transaction reset.

After every opened transaction, independent read-only reconciliation is required.
Durable completion must match the complete precommit snapshot except timestamps
and the truthful transaction read-only flag. Lost COMMIT acknowledgement, local
cleanup uncertainty, independent readback mismatch or audit failure returns
unconfirmed, with no automatic mutation retry. A separately bound durable
completion may be reported as `reconciledFinancialCompleted`, but does not turn
an uncertain transport outcome into runner success. Local process cleanup never
claims remote PostgreSQL backend cleanup.

## Implemented root contract: sealing must wait

`continuation_root.py` and its evidence, legacy-loading and guard helpers are now
implemented source-only. The golden authenticated capture proves the historical
queue change: attempts 654 to 655 and the exact failed schedule change, with all
other fields, non-target rows and metadata unchanged. Applied repair proof then
binds the exact unmasked after-snapshot; no ongoing checker mask is permitted.
Parent must review and seal the complete revised closure. No placeholder
implementation or boolean attestation replaces these operations:

- `prepare_root(captured)` returns an adapter whose methods are defined in that
  exact sealed file. It must authenticate any external dependency bytes before
  import and clean up partially initialized resources if construction fails.
- `prepare()` returns exactly `protectedSnapshot`, `original`, `provider`. The
  fresh RO snapshot must be bound to the retained audit, original failed-pass
  queue delta, immutable TLS diagnostic baseline and **actual successful repair
  after-evidence**. Preserve original Auth/catalog drift checks. Do not accept a
  latest snapshot as a replacement baseline or reuse a checker metadata mask as
  a continuation exemption. Original receipt HMAC/AEAD and provider evidence
  must be freshly authenticated; report booleans are not cryptographic proof.
- `guard(stage, transaction=None)` rechecks the global exclusive lock, source
  ownership/pins, physical identity, deadline, exact failed Docker history and
  separately reviewed reboot continuity, all stopped runtime units/config and
  absence of competing work. At the commit boundary the runner's transaction is
  intentionally open: the old separate-connection zero-other-transactions drain
  rejects it. Use the provided connection for a source-pinned, truthful RW drain
  check excluding only `pg_backend_pid()`; never ignore arbitrary other clients
  or forge readOnly. This in-transaction root inspection contract is still needed.
- `reconcile()` uses a separate RO connection and returns exactly `application`,
  `protectedSnapshot`, `original`, `provider`. It independently checks remote
  session/quiescence and preserves full physical state witnesses, including on
  ambiguous completion. It performs no repair, mutation or worker retry.
- `journal(phase, evidence)` writes private bounded root-owned audit artifacts;
  financial/provenance rows never enter public output. `close()` releases owned
  root resources without service actions. Its failure also prevents success.

Known external anchors, not new execution approval:

- Immutable diagnostic owner: `/root/baci-project-rollback-bootstrap.afv7kuzy/owner.py`,
  SHA `1893f5fa25ae2c1704e2d82f6c144dce750ed2c95731a875ba9ebea9069f9ccf`.
- Original projection source: `/root/baci-existing-projection-source.btzzmjl9`,
  release `f9d2fcb4caf7481ebe8c0720a0cceb572bd1557c2e83f7f6c17a33d4560286ed`.
- Immutable diagnostic after-snapshot:
  `/root/baci-project-rollback-tls.81u8stms/after-ecaad936c2a5455c8ec35a53ecf1f365.json`,
  SHA `1696661109ae4bcaaa0b8c10f0573c4df558b89f79a32f3aade2907d4b5879b8`.
- Parent's continuity dependency is pinned by the latest ledger repair owner;
  do not alter the old diagnostic owner or manufacture a failed systemd state.
- Background configuration SHA:
  `9a03772008dcd0fb5b220c70f9e66418037474e317ff8881935634727b8d825c`.

Parent now reports successful approved rehearsal and apply. Exact retained apply
paths/hashes and the proposed authenticated evidence chain are recorded in
`CONTINUATION_ROOT_DESIGN.md`. Their exact bytes have been inspected locally;
reported result booleans do not authorize the adapter. Captures are now verified
offline; explicit dual-source mapping isolates original collectors from patched
outer validators. Ohm's owned-transaction drain binds PID/XID immediately after
start and verifies them before COMMIT. Source preparation does not establish live
guard timing, fresh external Context checks, or execution approval.
There is no final continuation release seal.

## Closure and focused validation

### Reminder continuity: source correction, live proof pending

Parent's strict baseline inspection reports two missed-contribution reminders
inserted by the automatically enabled notification timer after reboot at
`2026-10-03T16:40:14Z`. Financial/Auth state and permanent metadata are reported
unchanged; notification events increased from six to eight, with no deliveries.
This is parent-reported state, not live evidence collected by this runner.

The new-goal reminder is `914e9941-c9c1-44a1-9879-1de3e54ac365`, type
`missed_contribution`, event key `missed:2026-10-02`, goal
`9f01153c-1589-4dde-b9aa-8f644a846832`. Its existing target count is one.
The source correction preserves that exact reminder and permits exactly one
additional contribution notification. Precommit compares every existing reminder
column hash; completion requires the reminder plus the contribution, and the
runner carries the original history into independent postcommit verification.
The empty-history contract remains compatible. Duplicate or extra events, changed
reminder fields, and unrelated historical drift still refuse. Independent source
review found no concrete reminder-loss or duplicate-credit bypass.

Do not drop either reminder, replace the historical baseline, modify immutable
helpers or weaken notification cardinality. Parent owns identification of the
second reminder and a pinned independent SQL proof that filtering exactly those
two new IDs preserves the historical six rows. The separate repair package now
has that protected proof; the continuation still needs its sealed root adapter
and actual successful repair evidence before any live execution. Source tests
cover preserved reminders as well as the earlier zero-reminder contract; they
are not evidence that the live payment has been credited.

The deployment manifest must contain exactly `kind`, `operationId`,
`executionDeadline`, `files`. `kind` is
`sealed-existing-payment-only-continuation`; the operation is
`ff561046-58e7-428d-9163-f6e60b0dab65`; deadline is `2026-10-06T15:59:10Z`.
The exact flat dependency set is exported as `continuation_release.FILES`.
Capture the existing application validators/collectors alongside these sources;
do not change immutable historical packages or the paired replay generation.
The bootstrap requires root and an isolated, non-optimized Python interpreter.
Do not execute its root entrypoint until the missing adapter, actual repair proof,
full closure and action-time approval have separately passed review.

Local focused tests:

```sh
python3 tools/staging/existing-payment-projection/continuation_runner.test.py
python3 tools/staging/existing-payment-projection/continuation_release.test.py
python3 tools/staging/existing-payment-projection/psql_transaction.test.py
python3 tools/staging/existing-payment-projection/projection_sql.test.py
python3 tools/staging/existing-payment-projection/projection_fence.test.py
python3 tools/staging/existing-payment-projection/inspection_sql.test.py
python3 tools/staging/existing-payment-projection/continuation_evidence.test.py
python3 tools/staging/existing-payment-projection/continuation_legacy.test.py
python3 tools/staging/existing-payment-projection/continuation_checks.test.py
python3 tools/staging/existing-payment-projection/continuation_root.test.py
python3 tools/staging/existing-payment-projection/owned_transaction_drain.test.py
python3 tools/staging/existing-payment-projection/continuation_runner_reconciliation.test.py
```

Runner tests are synthetic orchestration evidence; real PG helper regressions
use disposable fixtures with isolated test deadlines. Neither is live financial
completion, phone acceptance or proof that the repair was applied.
