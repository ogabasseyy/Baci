# Empty goal route enrollment sidecar

Prepared source only. No live query, remote call, enrollment, interest policy,
payment, transfer, or additional prefunding has been performed by this sidecar.
The sole durable candidate write inserts the exact new goal in
`prefunded_card.credit_routes`; existing exact enrollment is revalidated without
an update. Mapping and ledger binding must already exist. The shared company
budget remains 10,000 kobo; the old goal and every other covered row remain intact.
This does not override checkout reservations or enable public runtime execution.
The old `public_database_contract.py` one-route guard belongs to the installer
constructor, not request-time checkout or the compiled launcher. The compiled
launcher's private readiness check verifies restricted database connectivity;
it does not count credit routes. The parent reports that the actual root
financial bundle contains no `public_database_contract.py`. Its pinned source
here is an auxiliary review input, never imported or executed by this helper.
Source and runtime guards are not modified here.

## Missing exact inputs

1. Authentic parent **r4 exactemptyplancommit** JSON, including its actual
   approval/snapshot/source-manifest hashes, exact goal acknowledgement and
   `empty_interest_goal_commit` result. Independently verify the original audit
   artifacts and source closure before accepting this result. Parent-reported
   authentic source: `/root/baci-financial-owner.2ynkl9kc/empty-plan-r4-commit.json`,
   raw file SHA-256 `efbc7f7ae9a141e602e28377fd066e5d7c84763a53fd1f8ad1f5c6419b89c7ca`.
   This sidecar has not read that root artifact. The driver verifies its raw pin
   externally before supplying the decoded commit and canonical projection pin.
2. Fresh sanitized output from the parent's existing
   `tools/staging/interest-bridge/test-plan/read_empty_wallet.py`: authenticated
   exact business/API-customer/public/FAAS identities, interest enabled, integer
   zero balance, withdrawal count, response SHA-256 and real retrieval time.
   Maximum age 90 seconds through transaction postflight. Do not retime evidence.
3. Exact current physical database, session/current role, schema, role/password/
   membership/database ACL hash and complete protected table-state hash from
   `collect_sql()` below. Snapshot maximum age 300 seconds. The parent reviews
   installed routines, ACLs, RLS, constraints and triggers against its approved
   current staging baseline before pinning the database projection.
   Current `schemaMd5` must equal the authentic r4 commit's `schemaMd5`; the
   sidecar refuses changes even if the new inventory is independently pinned.
4. Independent parent-reviewed pins for those three projections. Fill both JSON
   templates; null entries deliberately refuse rendering. Pins are SHA-256 of
   canonical JSON (`json.dumps(value,sort_keys=True,separators=(',',':'),
   allow_nan=False).encode()`), not necessarily the raw artifact file digest.
   Hash agreement alone is not authentication. The registry must be supplied
   through the parent's trusted review path, never auto-approved from the bundle.
5. For apply: actual rollback receipt independently pinned by the parent and
   tied to the exact `candidateSha256`. Required shape:
   `candidateSha256`, `goalId`, `rolledBack=true`,
   `protectedStateUnchanged=true`, `routeAbsentAfterRollback=true`.
   Those booleans require post-session verification; SQL output before rollback
   does not prove rollback or commit. A lost apply connection remains unconfirmed.

The API and webhook customer strings come from the pinned parent source contract.
They are distinct namespaces, not aliases inferred by this implementation.
The parent provider readback must authenticate their link through its approved
identity proof. No payout destination or interest source namespace is assumed.
Interest policy creation remains blocked pending documented exact payout routing,
per-wallet eligibility, owner opt-in and provider economics evidence in the
separate parent policy lane. No disabled placeholder policy is inserted.

## Minimal parent query and execution contract

Generate the exact rollback-only inventory script locally from canonical source:

```sh
cd /Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/prefunded-card/empty-plan-enrollment
python3 -B -c 'from enrollment import collect_sql; print(collect_sql(), end="")'
```

For root staging, both `collect_sql(source_contents=sealed_sources)` and
`render(evidence, reviewed_pins, source_contents=sealed_sources)` accept an
explicit dictionary of repository-relative `SOURCE_PINS` keys to original
`bytes`. The key set must match exactly: missing, extra, non-byte or hash-altered
content refuses. All seven pins are checked, including auxiliary constructor
sources absent from the financial bundle; the driver must stage those approved
bytes separately rather than infer their location or omit them. Supplied maps
never fall back to `/Users` filesystem reads. Omitting the map retains canonical
local-path and symlink checks. The same bytes produce the same SQL and candidate
hash for the same evidence in either location.

The root driver independently validates root-owned mode-0600 staged source
closure, file identity and exact reviewed hashes before supplying the map. The
four sidecar implementation files remain loaded from the staged module's own
directory and included in candidate source hashing. No repository, clock,
deadline, proof or identity monkeypatch is required or supported by this change.
Re-seal this updated sidecar and perform a fresh candidate rehearsal: prior
candidate receipts bind the previous implementation hash and cannot be reused.

The parent supplies that exact script to its existing owner-local psql connection
for AppDB `7685292944002592802`, database/session/current user `postgres`, Unix
socket only. No connection alias, credential location or remote command is guessed
here. Use `-X -Atq -v ON_ERROR_STOP=1`; retain the final JSON object, not the blank
void-function output. It checks the exact new goal/binding, old goal/mapping,
treasury/company cap, absence of new history/policy and enabled evidence authority,
and returns only identity/time and hashes. Helper definitions are temporary;
the inventory SELECT runs in a repeatable-read READ ONLY transaction ending in
ROLLBACK. No permanent object, credential, row or role is written; no raw password
or provider body is emitted. The table coverage follows the pinned parent
`plan_tables()` contract: all non-infrastructure application tables plus
`auth.users`. Other auth/storage/vault/realtime infrastructure is outside this
candidate's writable scope. Parent global checks remain required.

Call `render(evidence, reviewed_pins)` to obtain rollback SQL and its candidate
hash. This pure helper never connects to a database or writes output files.
The candidate hash binds the complete evidence, reviewed pins and local helper
source closure as well as the SQL body; a replacement proof needs a new rehearsal.
The parent uses its existing private strict JSON loader and root-owned audit
storage, rejecting duplicate keys, symlinks, malformed/oversized inputs and
untrusted pins. `render(..., mode='apply', rehearsal=receipt,
rehearsal_pin=reviewed_receipt_hash)` returns the same transaction body ending
in COMMIT only after matching independently verified rehearsal evidence.

Rehearse first while provider and database evidence are fresh. After psql exits,
parent independently recollects inventory and checks identical metadata and no
new route before signing the receipt. Apply that exact candidate while the same
evidence remains fresh. If evidence expires, recollect and rehearse a new candidate;
do not edit timestamps. Apply postflight must confirm the exact route plus
unchanged protected hashes, zero new funds/policy and the old 10,000-kobo goal.
Identical fresh retry returns `already_enrolled`; conflicting or newly funded
state refuses. Every execution rechecks all guards, even on retry.

The SQL locks the entire parent table inventory and protected catalogs before
checking hashes and inserting. It rechecks after immediate constraints. A late
trigger/constraint side effect rolls back the route. No trigger disabling,
role/grant change, budget increase, history reconciliation or function replacement
is part of this candidate. Deadline is checked again at postflight.

## Focused local verification

```sh
python3 -B contract.test.py -q
python3 -B enrollment.test.py -q
```

Tests use synthetic evidence and a disposable PostgreSQL 17 cluster from the
existing Homebrew installation, with an isolated Unix socket and no TCP listener.
They install nothing and touch no parent database. Tests substitute only the
scratch physical ID and deterministic clock in the generated SQL; production
helpers expose no identity override. Fixtures never represent live proof.
The parent owns full lint/typecheck/test and integration review. No global checks,
builds, installs, commits, browser actions or remote writes run in this lane.
Portability regressions cover exact missing/extra/tampered/non-byte source-map
refusal and canonical versus explicit staged content equality for collection,
rehearsal and apply. They use real default time with fresh synthetic evidence,
without monkeypatching or timestamp overrides.
