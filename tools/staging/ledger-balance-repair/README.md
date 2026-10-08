# Deferred ledger balance checker repair

## October 3 post-reboot readiness

### Approved repair completed

After explicit owner confirmation, the protected five-file package completed
`--rehearse` and then `--apply`. The rehearsal validated deferred constraints
under the restricted projection identity and rolled back. Independent apply
readback proved only the checker's authority flag changed; all rows, reminders,
principals and the preserved failed worker remained unchanged. No payment,
transfer, application credit or service activation occurred.

Rehearsal audit: `/root/baci-ledger-balance-repair.a38y2rb7`.
Applied-repair audit: `/root/baci-ledger-balance-repair.9xx36nvp`.
Its `after-f647e2f2add94c038ba1ec5ab9f0a171.json` SHA-256 is
`d2f70b36ad83ea8e6385189a86cbf132671e136bd176cf045414c4d530046478`.
The existing-payment continuation must authenticate this actual evidence and
retain its separate full-state fences. The payment remains unapplied.

The readiness notes below record the earlier preparation, not current approval
or application status.

The authorized reboot reset systemd's historical failed invocation. The narrow
`reboot_continuity.py` adapter returns the actual inactive state, binds it to the
authorized boot, and independently verifies the original invocation in the
previous boot's journal and the unchanged failed Docker container. All original
source, configuration, profile, quiescence, lock and deadline guards remain.

The existing October 6 replay stop timer was rearmed without changing its bytes,
deadline or stop target. The automatically enabled notification scheduler was
paused for exclusive recovery. No financial worker was restarted.

That scheduler had inserted exactly two missed-contribution reminders. A physical
read-only comparison proved all six historical notification rows unchanged and
all other permanent tables, Auth state and metadata unchanged. The protected
proof is `/root/baci-reminder-continuity.sb522x47/proof.json`, SHA-256
`55c52b6b8797b8b17b144fbd66dd59817fcc1efe5177a617b8616d7979907169`.
`reminder_continuity.py` accepts only those exact pinned additions for historical
comparison. Actual before, transaction and after snapshots retain all eight
events; other drift still refuses. No reminders were removed or edited.

The final five-file runtime package is protected at
`/root/baci-ledger-continuity.clooltoe`. Archive SHA-256:
`8a544f39d46efa14328d530bfdc2120772f14c0a4de4d5e7941fe4ccb8a873e7`.
Read-only preflight passed, with evidence retained at
`/root/baci-ledger-reboot-inspection.9wx5xlhs`. Neither repair mode was executed;
checker authority and both plan principals remain unchanged. Explicit action-time
confirmation has been requested for rehearsal and the metadata-only repair.

Focused continuity, owner and PostgreSQL tests pass. Independent bounded source
review found no general baseline exemption; captured notification witnesses now
exercise the real digest gate. CodeRabbit was attempted but rate-limited, not
green. Global lint/typecheck still fail in unrelated existing mobile files.

## Verified failure

The existing test payment was collected by Paystack and transferred to the
PiggyVest sandbox wallet, but its application projection is still unapplied.
The restricted projection inserts balanced ledger postings; its deferred
`check_balance()` trigger then fails with PostgreSQL `42501` when the outer
transaction validates constraints. The transaction rolls back the application
credit. A successful SELECT followed by ROLLBACK did not prove commit readiness.

The actual restricted TLS diagnostic forced deferred constraints, confirmed
rollback and independently proved the complete protected snapshot unchanged.
Audit: `/root/baci-project-rollback-tls.81u8stms`.
Its after-snapshot contains 376 permanent relations and is pinned by `owner.py`.

## Narrow repair

The append-only candidate changes only the existing checker's execution mode to
`SECURITY DEFINER`. Its owner, exact body, fixed `pg_catalog` search path, EXECUTE
ACL, two deferred triggers, table ACLs and balance checks remain unchanged.
It adds no direct table access to the restricted financial role.

`owner.py` authenticates its existing sealed root dependency before importing
application modules. It requires the original failed worker to remain stopped,
the global exclusive lock, the physical staging database identity, the October 6
deadline and the exact unchanged diagnostic baseline.

- `--rehearse` temporarily applies the candidate, checks the full snapshot inside
  the same transaction, projects only the existing operation under the restricted
  role, asserts `applied`, forces deferred constraints and rolls everything back.
- `--apply` commits only the metadata repair. It does not project a payment,
  start a worker, claim a receipt, contact a payment provider or change balances.

Both modes retain private before/execution/after evidence. The in-transaction
fence and independent readback permit only the checker authority flag to differ
for apply. Failed or ambiguous runs are unconfirmed; do not blindly retry them.

## Validation and deployment boundary

Forty targeted tests pass: 13 owner-contract, 11 main-flow, five real PostgreSQL
snapshot-fence and 11 deferred-checker regression tests. PostgreSQL fixtures are
disposable and do not represent a live financial credit. Parent and agent review
cover the generated transaction fence and failure evidence retention.

The repair is prepared, not yet applied to staging. The action-time approval for
the checker authority change is still required. Copying a sealed package is not
approval to execute either mode. Preserve the immutable previous projection
package and failed worker evidence.

The reviewed archive is staged and hash-verified at
`/home/bassey/baci-ledger-balance-repair-5265131ca352/repair.tar`.
SHA-256: `5265131ca35274c88a296aa3b35b9383afb9d349f645d530239331865aa285a0`.
The root web console authenticated and copied its four exact regular files into
`/root/baci-ledger-balance-package.1ccdni1g` with protected ownership/modes. It
reported `repair-package-protected-not-executed`; neither mode was executed.
The final CodeRabbit review covered the four owner Python files and raised zero
issues. The SQL candidate is independently covered by real PostgreSQL regressions.

The separate inbox readback now uses the shared pinned-profile authentication
helper and requires actual HTTP 200 responses. Its pure exact-event verifier
checks the independent expected event rather than treating inbox counts as
notification acceptance. These 21 focused tests and the final CodeRabbit review
pass, but the changes are local, not deployed. Distribute/seal the authentication
helper beside the readback script; it can no longer be uploaded alone. Neither
the counts summary nor the pure verifier establishes a physical push receipt.

## Existing-payment-only continuation design

The source review found a way to finish the existing dispatch without granting
queue-table writes or restarting the failed worker. This is a reviewed design,
not an implemented or authorized live runner:

1. Authenticate the original retained audit, the failed pass's exact target queue
   delta, the TLS diagnostic baseline and the repair's exact after-evidence.
   Keep the original failed container and systemd invocation unchanged.
2. In one READ COMMITTED transaction, require the complete scoped eligible queue
   set to contain only the fixed operation. `claim_due(limit=1)` alone does not
   select that operation; validate its returned singleton operation and token.
3. Under the actual restricted session identity, call the existing `project()`
   once and require `applied`, then `finish_dispatch()` with that claim's token
   and require true. Force deferred constraints before returning to privileged
   protected-state inspection. Neither function collects or transfers money.
4. Before COMMIT, verify the full allowed delta and exact completed report,
   including one attempts increment, cleared queue token/lease and finished time,
   both plan principals, the entire unchanged treasury row and one notification.
   Recheck the deadline. Refusals roll back the claim and credit together.
5. Independently read the physical database after completion. An ambiguous COMMIT
   acknowledgement requires read-only reconciliation, never an automatic retry.

The old projection package cannot be rerun unchanged: its retained baseline and
zero-exit worker requirements deliberately reject the subsequent queue state and
preserved failed invocation. Do not relax those guards or carry the checker's
temporary comparison mask forward as a general metadata exemption.

The October 3 owner-authorized reboot reset the original failed systemd state.
Its historical invocation and stopped container remain evidence, not a state to
manufacture with another failed pass. A separately reviewed reboot-continuity
check must preserve the retained audit and full financial snapshot comparison
before the existing repair can run. The prepared repair has not been executed.

The separate `existing-payment-projection` transport, SQL extraction and
precommit fences are source components, not a sealed live continuation runner.
The stock-psql transport now enables `ON_ERROR_STOP` in every frame, including
when the caller omits that argument. Its 21 focused tests cover that refusal,
rollback and cleanup behavior; they do not establish application credit.

## Remaining integration gates

1. Rehearse the sealed repair on staging, apply the metadata-only change after
   approval and repeat actual restricted TLS constraint validation with rollback.
2. Separately review the existing-payment-only continuation against the repair
   audit and original signed receipt/provider evidence. Do not re-run collection
   or transfer. Prove one 10,000-kobo new-plan credit, the old 10,000-kobo plan
   unchanged and the total company prefunding cap still 10,000 kobo.
3. Rehearse and activate the already reviewed paired claimant fence; check actual
   old/new token behavior and restore only the sealed, deadline-bounded runtimes.
4. Confirm authenticated wallet, goal, Earnings and the exact new notification
   through the phone origin, not only inbox counts. Event creation and inbox
   authorization are goal-generic; the old-goal-only owner/readback diagnostics
   cannot certify the new event or authorize notification schedule restoration.
5. Keep genuine provider interest payout delivery separate from the supplied
   733-kobo fixture contract test. Do not credit the foreign sample customer.
   PiggyVest says on-demand staging interest payout testing is unavailable.
6. Close the separate daily-accrual queue-health gap with the existing restricted,
   non-crediting observer. The prepared paired generation has no observer; it
   leaves accrual retryable until retries exhaust. Observer sources currently
   live in the original `0d77` worktree, not the owner-tools worktree. Do not claim
   those sources are already in the deployed generation or broaden paid-interest
   authority to process them.
7. Keep native build identity, installed phone, notification permission, valid
   device token and actual push receipt as explicit physical-device acceptance
   gates. In-app events do not establish push delivery.

Production remains outside this repair and staging activation scope. Existing
unrelated mobile lint/typecheck failures are not a clean global quality gate.
