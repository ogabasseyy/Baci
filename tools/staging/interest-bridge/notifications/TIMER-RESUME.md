# Ordinary notification timer resume (source-only)

`notification_timer_resume.py` exposes only parent-injected `restore_timer`.
No deployment, root CLI, credential renewal, grants, unit edits, timer enable,
financial worker action or automatic retry is included. Existing worker/unit/CA
pins and the independently armed Oct6 15:59:10Z stop timer remain unchanged.

## Read-only collection closure

- `notification-scope-query.sql`: SHA256
  `1c7a8d44fb84f37d2357509abeefbc5d8465bdd1d7094c25beaa81ad8e3c30a7`.
- Unchanged `notification-role-guard.sql`: SHA256
  `9384fd9054ac08fc88b799ab7dfd666ca77dd049e12d9c7757d405bbf63d3e63`.
- Existing `tools/staging/replay-complete-cutover-owner/financial_snapshot.sql`:
  authenticate its exact reviewed bytes through the parent's existing closure.
  No financial snapshot baseline or checker mask is changed here.

For standalone inventory, insert the unchanged role guard immediately before
`WITH goals AS MATERIALIZED` in the scope query. Authenticate both input files
and the composed SQL before execution. Run stock psql with `-XqAt -w`,
`ON_ERROR_STOP=1`; retain output privately. The SQL ends in ROLLBACK and never
invokes enqueue/claim/finish/receipt routines. It includes all active eligible
goals, all global events and deliveries, globally active storefront tokens,
role flags/expiry, twelve routine body/ACL pins, direct executions and effective
SECURITY DEFINER executions. Orphans retain null actor and fail scope validation.
Tokens, tickets, titles and bodies are hashed, never emitted as plaintext.

For activation proof, collect scope and the full protected snapshot within ONE
actual repeatable-read READ ONLY transaction. The authenticated parent collector
must compose the existing snapshot SQL and scope SELECT/role guard with only
one BEGIN and one final ROLLBACK; retain both original outputs. It returns
`{scope, database, protectedSnapshot}`. Do not run the two standalone transactions
and label them a shared snapshot, fabricate readOnly, or omit the role guard.
Capture timestamps must be actual UTC values within five seconds of each other.

## Exact remaining inputs

Parent-reported fresh counts are two eligible goals, nine scoped events and zero
globally active storefront tokens. Counts alone do not authorize activation.
Seal the complete fresh inventory bytes and SHA after independently checking:

- Exactly the old/new approved goals and unchanged complete goal row hashes.
- Exact nine approved event IDs/keys/types, immutable full-row content hashes,
  including `914e9941-c9c1-44a1-9879-1de3e54ac365`,
  `b5c93597-2989-45d9-bed4-85ec220e4240` and
  `ad00ea01-65f0-4594-b4f9-71cb609c6aaa`; no duplicate scoped keys.
- Every delivery, including any historical delivery, belongs to those events;
  zero raw token/ticket values are exported. No orphan or foreign scope.
- Actual postcredit financial baseline, Auth, complete permanent metadata and
  all non-notification relations match the already approved retained baseline.

The reviewed manifest is exactly `inspection`, `scopeBaselinePath`,
`scopeBaselineSha256`, `expectedEvents`. `inspection` is the existing postcredit
inspection manifest, extended with the actual source origins of every callback,
these new modules and both fixed SQL files. Before importing ANY module, parent
authenticates the closure with protected stable nofollow reads. Each guard
rechecks every source/asset/unit and the held exclusive cutover lock.

`expectedEvents` is a finite reviewed list of exact `{goal,eventKey,type,
contentSha256}` for possible scheduler-generated missed/weekly events during
the bounded restoration window. Its content hash is PostgreSQL SHA256 over the
full event JSONB minus id, created_at and push_expanded_at, preserving null
read/void fields and every hidden content column. Derive it with reviewed pure
SELECT calculations matching pinned `generate_due`, never by calling that
writing function or guessing titles/amounts. An empty list authorizes NO new
event during proof; unexpected enqueue effects cause refusal and owned cleanup.
The exact forecast hashes have not yet been supplied. Existing nine rows are
never stripped, replaced, regenerated or rebaselined.

The sanitized actual inventory captured at `/root/baci-notification-scope.YvFASk9a`
was downloaded to `/private/tmp/baci-notification-scope-20261003.json`, SHA256
`5dfda373c8461831031380c9f2defeff49f3e28a37ca049fd006f578e40e3d09`.
Pure scope, role/routine/grant and unchanged-transition validation passed on those
exact bytes. That file contains scope/database only, NOT the full postcredit
snapshot, so it is not promoted into a financial baseline. Both actual reminder
hash mutation regressions refuse. The fixed query remains unchanged.

## Bounded action and stop boundary

After fresh completed-payment inspection, exact inventory equality and source
checks, start only `/usr/bin/systemctl start baci-savings-notifications.timer`
once (30s). Prove the submitted job terminal; `settle(service, timeout=80)` is
an authenticated bounded read-only wait for the first ordinary worker run to
become inactive. No direct worker start is issued. This matters because the
existing OnBootSec timer can fire immediately after restoration.

Require actual inactive worker/check/stopper, zero pending jobs/PIDs, timer
active/waiting with next invocation more than 120s away, unchanged Oct6 stop
timer, and independent RO readback within 120s. Existing events may only acquire
push_expanded_at; hidden content/read/void/identity fields cannot change. New
events must match the finite exact content list. Delivery transitions are
bounded to existing worker paths and approved token hashes; terminal deliveries
are immutable. Full financial/Auth/catalog/non-notification data must not change.
DeviceNotRegistered token deactivation is NOT silently allowed by this contract.

Failure stops only byte-pinned/effectively-owned timer and ordinary worker.
Pending/unknown start jobs or cleanup failure leave cleanup unconfirmed; a
failure report never claims protected state unchanged. Cleanup does not undo
already committed notification mutations. No automatic retry follows refusal.

Success proves initial scheduling restoration, not future-run or device receipt
acceptance. Zero tokens is reported honestly as `no-token` and does not prohibit
the authorized timer start. Phone registration/EAS credentials/push signing and
actual provider/device receipts remain separate delivery gates. No timer has
been restored by this source work.

## Focused tests

```sh
python3 tools/staging/interest-bridge/notifications/notification_scope.test.py
python3 tools/staging/interest-bridge/notifications/notification_timer_resume.test.py
python3 tools/staging/interest-bridge/notifications/notification-scope-query.test.py
```

Timer tests mock the previously tested completed-payment inspection and root
callbacks; fixtures are explicitly offline, not deployable source authority.
SQL tests execute the SELECT on disposable PG17 (no installs), test redaction
and hidden-column hashes, and separately prove the production identity guard
refuses that scratch cluster. They do not claim live routine/grant acceptance.
