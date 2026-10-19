# Additive claim-boundary owner installer

New files: `installer.py`, `installer.test.py`, `identity.sql`, `identity.test.py`,
`snapshot.sql`, `snapshot.test.py`, `guard.sql`, `guard.test.py`,
`evidence.template.json`, `rehearsal.template.json`, and this `README.md`.
Materialized support adds `materialized-locks.sql`, its colocated test,
`materialized-snapshot.test.py` and a PostgreSQL 17 test-only fixture.
Focused local checks cover 19 renderer + 8 snapshot + 6 guard + 3 identity,
plus 3 materialized snapshot + 7 materialized lock tests.
The actual PostgreSQL OID/string capture incompatibility was reproduced RED,
then corrected and confirmed GREEN without clock/source/physical-ID overrides.
Runtime closure SHA256:
`e88aa1ad9d25ff7a6eacf16e66f8f642b840336eb251274a79a42ab0101e9653`.
This covers `installer.py`, the four SQL assets and the exact migration pin,
not these synthetic tests or documentation; parent full-source checks remain
separate. No root/live rehearsal or installation is claimed.

Offline, source-only SQL rendering. Nothing here connects to a database, runs SQL,
calls a provider, creates a payment, installs dependencies, or changes old seals.
The parent owns root source verification, quiescence, evidence collection,
independent review, execution and the future additive installation chain.

## Exact change

Only these existing bodies may change:

- `prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid)`
- `prefunded_card.claim_reconciliation(uuid,integer)`

The byte-pinned rewriter is
`supabase/migrations/20261002160000_prefunded_first_card_claim_boundary.sql`:
`05af1e6f87a118aefe6cf097569daa5dcf7e52922cfb1d1fdbff884b2f5d67ae`.
No old migration or installed r8 seal is replaced. This is additive owner DDL,
not routine payment recovery or public startup configuration.
Unpromoted checkout verification stays checkout-owned; already promoted verified
`funding_pending` / `completed` operations retain generic worker eligibility.
No clearing existing leases, resetting phases, promoting collections or budget
changes occurs. Interest routing or payout behavior is not assumed.

## Inputs still required from the parent

Use the actual output of the guarded capture, not the illustrative template.
Missing live facts are deliberately not supplied:

- Fresh full `pg_proc.prosrc` bytes and SHA256 for each exact function, plus
  OID, owner name/OID, ACL including actual null vs explicit ACL, language,
  SECURITY DEFINER flag, exact configuration and all-other-catalog-fields hash.
- Actual database name/OID and role OID from a local Unix-socket `postgres`
  owner session on physical AppDB `7685292944002592802`.
- Every permanent non-system table's OID, row count and full row-multiset hash,
  including all recovered-payment, treasury, queue, authorization, plan and
  ledger rows. No financial fields or selected rows are exempted.
- Permanent metadata hash, actual capture time and verified source-closure hash.
- Separately reviewed canonical evidence hash. Apply additionally requires a
  separately reviewed paired rehearsal receipt and its canonical hash.

## Rendering and owner execution boundary

Load `installer.py` through `importlib.util` and call its primary `render` export.
Default canonical source remains `/Users/mac/Baci-worktrees/cursor-savings-phase1`.
A root staged driver may pass `migration_source=<exact sealed bytes>`; the same
SHA256 pin is mandatory. Other runtime assets are loaded adjacent to the module.
Do not monkeypatch paths, pins, identities or clocks. Independently verify the
five runtime files and pinned migration before importing/executing root copies.

`render(mode='capture')` emits the minimal complete owner evidence query:
identity checks, one read-only repeatable-read snapshot SELECT, then ROLLBACK.
It performs no temporary or permanent DDL. No provider verification is needed.
Foreign tables are never queried and still block install rather than receiving
silent exemptions. Populated materialized views receive the same complete
row-multiset hash as tables. Unpopulated views are explicitly captured using
their actual `relispopulated=false`, count zero and a distinct hashed
`materializedState=unpopulated` marker; they are not treated as populated empty
views or queried as though populated. Each materialized row pin also includes
exact owner name/OID, relation OID, kind and populated state. Sequence values are read without
advancement. Enabled event triggers block before any installer DDL.

`render(evidence, reviewed_evidence_sha256=<reviewed canonical hash>)` defaults
to ROLLBACK. Capture is valid for at most 300 seconds and the fixed deadline is
`2026-10-06T15:59:10Z`, checked using actual Python and PostgreSQL clocks.
The SQL checks actual database/role identity, locks permanent tables and relevant
catalogs, compares exact fresh evidence, acquires materialized locks, then
repeats the full snapshot/guard before executing only the pinned two-function
rewriter, and checks every row hash and permanent metadata remains unchanged.
Function OID/owner/ACL/search path/language and all other catalog fields must
remain exact. Only their separately calculated body replacements may differ.
Session settings and temporary tables are transaction-local; no permanent
tables, roles, privileges, rows or migration-history records are installed.

Quiesce all public/background workers and timers BEFORE the fresh capture and
keep them stopped through rehearsal, independent review, apply and verification.
This includes materialized refreshers and independent maintenance/sequence
writers, not just the payment timer. Catalog locks also affect the whole cluster.
Catalog/table locks are owner-wide and bounded by lock/statement timeouts;
they are not a replacement for quiescence, particularly for sequence writers.
Use a dedicated clean owner connection, fail-fast execution and disconnect on
error. Do not nest inside an existing transaction or continue an aborted one.

Materialized locking uses `ALTER MATERIALIZED VIEW <quoted schema/view> OWNER TO
<exact current catalog owner>` ONLY after full fresh row/catalog preflight and
while the catalog locks are held. The owner must match its captured name/OID;
no alternative owner is accepted. PostgreSQL 17.11 disposable tests prove this
same-owner command retains AccessExclusiveLock through the transaction without
changing owner, ACLs, reloptions or any captured permanent metadata/data. Both
regular and CONCURRENTLY refresh attempts wait specifically on that relation
and terminate with lock timeout in those tests; no refresh completes. The asset
also verifies the held catalog and materialized locks through `pg_locks`.
Fresh post-lock and post-rewriter full snapshots remain mandatory. No REFRESH,
different-owner ALTER, privilege change or financial delta exists in generated
installer SQL.

The prior `da110c...e4aa7` closure and old root capture/receipt are obsolete for
this support change. Independently seal the new closure, recapture the actual
eight views and ALL other permanent relations, then rehearse with fresh proof.
PostgreSQL 17.11 local evidence is not a root PostgreSQL 17.6 rehearsal or apply.

## Paired rehearsal receipt

The postflight SELECT is not proof that the following ROLLBACK completed.
The parent must observe successful ROLLBACK and collect another guarded read-only
snapshot, verifying it equals the original evidence after removing `capturedAt`.
Record the observed normalized snapshot hash as `restoredSnapshotSha256`.
Do not synthesize success flags from generated SQL or these local tests.

Canonical JSON hashing is SHA256 of UTF-8 JSON with sorted keys, no whitespace,
`ensure_ascii=False`, `allow_nan=False`, and separators `(',', ':')`.
`tableRowsSha256` hashes the entire captured `tableRows` object.
`expectedFunctionsSha256` comes from the observed, successfully checked rehearsal
postflight result. `rollbackSqlSha256` hashes exact emitted ROLLBACK SQL bytes.
The independent reviewer supplies all true flags and `reviewedAt` only after
checking the root transcript, restored snapshot and both source/evidence pins.

`render(evidence, reviewed_evidence_sha256=<pin>, mode='apply', receipt=<receipt>,
reviewed_receipt_sha256=<independently reviewed pin>)` emits the exact rehearsal
SQL with only terminal ROLLBACK replaced by COMMIT. Missing, changed, stale or
unpaired evidence/receipt refuses. If anything changes, capture and rehearse again.
An exact repeated installation uses fresh current evidence; the pinned rewriter
recognizes its original predecessor and does not duplicate the patch.

## Focused validation

Run only these colocated tests with `PYTHONDONTWRITEBYTECODE=1 python3`:
`installer.test.py`, `snapshot.test.py`, `guard.test.py`, `identity.test.py`.
Also run `materialized-snapshot.test.py` and `materialized-locks.test.py`; they
select installed PostgreSQL 17 binaries directly, not production identity,
source or clock overrides. A missing binary skips these tests and leaves
materialized support unverified; it is not readiness evidence.
PostgreSQL tests use disposable local Unix-socket clusters and existing binaries.
The production physical guard is tested to REFUSE that cluster, without overrides.
Positive rewriter-core tests separately use the disposable cluster's own captured
identity and original function pins; they do not constitute root/live proof.
No clocks, production source pins or production physical checks are overridden.

## Remaining owner transfer-completion work

No transfer-completion SQL is implemented in this sidecar. Its financial
no-change guard must not be weakened to accommodate a different owner action.
For operation `ff561046-58e7-428d-9163-f6e60b0dab65`, the separate helper must
guard goal `9f01153c-1589-4dde-b9aa-8f644a846832` and amount 10000 kobo, require
fresh independently validated native terminal-success proof, then use only:

- `claim_reconciliation(uuid,integer)` with a fresh 60-second lease;
- `complete_reconciliation(uuid,uuid,bigint,text,text,jsonb)` with that exact
  returned token/fence and leg `transfer`, outcome `verified_success`;
- `project(uuid,text)` with exact physical AppDB, checking `applied` or a proven
  matching duplicate, never dispatching or starting a second transfer.

Canonical pointers are `storage-functions.sql:89`, `storage-functions.sql:102`,
`storage-functions.sql:118`, `projection-functions.sql:39`, and
`evidence-transfer.sql:2` in the parent prefunded-card directory.
Those are source pointers, not fresh installed body pins or live proof.
`lock_scoped_operation(uuid,boolean)` at `storage-functions.sql:12` requires
`binding.authorized_login = session_user`; a postgres owner session alone does
not establish execution eligibility. Do not guess that login or alter bindings,
worker profiles, roles, leases, operation phases or installed function bodies.
The additive claim boundary also requires the actual associated checkout to
already be promoted with stored verified collection; do not bypass this gate.

Parent/Helmholtz still supplies fresh native proof and normalization receipt,
actual installed function closure/body pins and owner/ACL metadata, approved
session identity, exact operation/intent/treasury/mapping/goal before rows,
unexpired proof/lease timing, and reviewed exact allowed financial delta.
The new helper needs separate full-metadata and outside-approved-row hash guards,
matching new ledger/projection/contribution/alias additions, treasury reserved
-10000 and consumed +10000 only once, unchanged old goal/opening/budget/security
state, default ROLLBACK and independently reviewed paired apply receipt.
Native signature availability or transfer acceptance alone is not terminal proof.
