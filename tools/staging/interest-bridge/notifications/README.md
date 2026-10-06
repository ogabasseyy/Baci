# Savings notification renewal and activation

The owner helper renews the existing notification worker and activates its
schedule through `2026-10-06T15:59:10Z`. The approved scope is synthetic merchant
`10000000-0000-4000-8000-000000000001`, customer
`10000000-0000-4000-8000-000000000002`, and goal
`430314fd-cd8b-4579-98d4-e9f345713dd6`.

## Guards and exact changes

Only the existing `baci_savings_notifications_worker` role validity changes in
the database. Both service `ExecCondition` epochs change from `1790697550` to
`1791302350`; the deadline timer's `OnCalendar` changes to 6 October. The helper
appends `RemainAfterExit=yes` only to the check service's `[Service]` section,
retaining the completed read-only oneshot until its execution is verified.
It preserves the password, grants, role flags, normal timer, stopper targets,
worker bundle, CA, and credential. It uses the existing TLS hostname and
`verify-full` URL. Read-only preflight verifies physical database
`7685292944002592802`, the twelve observed routine bodies/ACLs, the exact five
worker execution grants, synthetic scope, and 10,000-kobo principal.
The effective TEMP privilege observed through PUBLIC is preserved; an explicit
worker TEMP grant refuses. No privilege is granted or revoked.

The owner must leave the normal timer, delivery worker, check worker, and stopper
inactive before invocation. All unit fragments must be the pinned root-owned
0444 regular single-link files, with no drop-ins or reload pending. Existing
backup/candidate/attempt paths refuse before live changes. Every invocation
needs more than three minutes before expiry. A locked rollback rehearsal and
independent readback run before any commit; the commit compares all protected
roles/passwords/grants/functions and financial/notification rows under locks.
Original unit bytes are retained in `original/`, candidate bytes in `candidate/`.

After the commit, the helper swaps the three deadline fields and check-only
retention setting, reloads systemd, and requires a newly executed successful
`--check` service: a fresh positive main-start timestamp, status zero, code
`1`/`exited`, and `active/exited` state. Cleared/default zero execution metadata
never counts as proof. The helper immediately stops the check service and verifies
`inactive/dead` before database readback or any timer activation. This checks
the existing restricted TLS credential without enqueue, claim, receipt or push
calls. Its database snapshot must remain equal. The helper then arms and verifies
the deadline timer's actual next firing time and effective stopper argv before
enabling the normal timer. The normal timer can immediately invoke the existing
delivery worker; Expo requests and queue state changes are expected after
scheduling. It has no financial provider, payment or interest-credit operation.
Do not add other tenants, eligible goals or notification events outside the
approved synthetic scope while this unparameterized worker is scheduled.
Do not include push tokens, message bodies, URLs, or credentials in reports.

## Sealed owner execution

The parent reviews this source and tests locally, then copies exactly the eight
files named in `SHA256SUMS` and that manifest into a fresh directory directly
under `/root`. The directory must be root-owned 0700, and every source/manifest
file root:root 0600, regular and single-link. No credential is uploaded. Verify
the manifest's SHA-256 against the reviewed local seal, then verify every entry
with `sha256sum -c SHA256SUMS` **before running Python**, since imports execute
before the helper's own source validation. Execute from that root directory:

```sh
/usr/bin/python3 -B notification_owner.py --inspect --bundle-sha256 429528604e873c4837449502925bd2a60725394b5a6cca8018fa78411ddc5713
/usr/bin/python3 -B notification_owner.py --rehearse --bundle-sha256 429528604e873c4837449502925bd2a60725394b5a6cca8018fa78411ddc5713
/usr/bin/python3 -B notification_owner.py --activate --bundle-sha256 429528604e873c4837449502925bd2a60725394b5a6cca8018fa78411ddc5713
```

`--inspect` performs only the guarded read-only query in
`notification-state-query.sql`, including routine signatures, body hashes,
owners, search paths and ACLs. It is the exact query to collect if a baseline
refuses; it does not invoke any notification routine. `--rehearse` retains
`rehearsal-result.json`. `--activate` repeats rehearsal and retains
`activation-attempt` and `activation-result.json`. Local validation command:

```sh
for test_path in tools/staging/interest-bridge/notifications/*.test.py; do
  python3 -B "$test_path" || exit 1
done
```

Success is `notifications-scheduled`; actual device delivery still requires
independent ticket/receipt and phone evidence. Failure after an attempted commit
stops/disables scheduling and checks quiescence before restoring only known
candidate/original unit bytes and the old role validity. Expired original units
stay stopped. All failed recovery steps are reported; no ambiguous commit is
retried. Audit-write failures retain the earlier report as `priorReport`, including
its original stage, error and recovery failures. Retain the private directory,
inspect `recoveryFailures`, and independently
read role/unit/timer state before deciding recovery. Previously dispatched pushes
cannot be rolled back.

## Owner web-console evidence, 2 October

The parent collected the read-only SQL result and fresh root-owned unit, worker,
CA and credential metadata at
`/home/bassey/baci-notifications-readback.FrE3FyYL/result.json`. The worker role
has its five required function grants, no table grants and no memberships, but
still expires at `2026-09-29T15:59:10Z`. The scoped plan remains at ₦100, with
five existing events and zero deliveries. No provider, push, claim or enqueue
operation ran. The expired timer was subsequently stopped after exact hash,
role-expiry and inactive-worker checks; the worker remains inactive.

This report supplies the missing predecessor hashes; it is not a renewal or
activation approval result. A separately guarded renewal still needs exact
routine/role privilege baselines, rollback rehearsal, restricted TLS read-only
readiness and effective new deadline verification before delivery can start.

The later routine inventory is
`/home/bassey/baci-activation-inventory.co4hz6c_/result.json`, captured locally as
`/private/tmp/baci-activation-inventory-20261002.json`. All twelve notification
body hashes match their append-only migrations. Their exact observed owner,
definer, search-path and ACL contracts are enforced before renewal and scheduling.
This helper has been exercised locally with mocked host commands; the parent
performs the real owner rehearsal, commit, TLS check and timer verification.

The parent's first activation attempt ran `--check` successfully (journal JSON
`enabled=true`, all counts zero), but systemd garbage-collected its unreferenced
completed oneshot and cleared execution metadata before readback. The helper
refused and the parent verified full restoration of the old role expiry and
original units. This is not evidence of TLS failure. The retained check candidate
fixes that proof lifetime; preserve that journal response and obtain fresh retry
evidence. The existing unchanged database before/after guard remains mandatory.
