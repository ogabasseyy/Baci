# Independent provider evidence

This bundle's worker activation is separate from its source and SQL rehearsals.
The 27 September read-only legacy-history verification also exercised the provider
reads; see `legacy-history.md`. That verification did not activate a worker,
provision credentials, send money, or change production.

Load after the existing prefunded-card projection bundle, in this order:
`evidence-storage.sql`, `evidence-projection-storage.sql`, `evidence-conflict.sql`, `evidence-record.sql`,
`evidence-transfer.sql`, `evidence-inflow.sql`, `evidence-projection.sql`, `evidence-legacy.sql`. The fixture and test files are
disposable database inputs only. There are no new registered migration timestamps.

## Source interface

`createPrefundedCardProviderEvidence({ configuration, execute, fetchImplementation })`
accepts an integration UUID, physical PostgreSQL system identifier, webhook signing
secret, and existing staging PiggyVest configuration. Supply the dedicated executor
for the instance's role; the global receipt executor is not used or extended.

- `ingest({ rawPayload, signature })` authenticates bounded raw bytes, stores a
  digest and deferred receipt before HTTP, then independently reads provider evidence.
  Returns `stored`, `duplicate`, `deferred`, `conflict`, `invalid_payload`, or
  `invalid_signature` in `outcome`. Storage failure throws; it must not be acknowledged
  as durable acceptance. Existing authenticated inbox replay supplies original bytes
  for recovery; this evidence store does not retain sensitive event bodies.
- `verifyTransfer(claim)` returns `verified_success` plus the stored evidence, or
  `deferred` / `reconciliation_required`. It performs no HTTP and requires a recorded
  transfer attempt. Parent provider integration can invoke it before TSQ fallback;
  reconciliation must never fall through to a permissive verifier.
- `classifyInflow(eventId)` returns `bank_inflow` with the independently mapped
  integration/merchant/customer/goal, transaction, wallet, reference, amount, zero
  fee, and NGN currency; otherwise `bridge_inflight`, `bridge_duplicate`, `deferred`,
  or `reconciliation_required`. Its classification is durable. It does not itself
  credit funds. Never route an unknown classification to the legacy inflow writer.
- `applyInflow(eventId)` invokes the atomic SQL bank projector. Returns `applied`,
  `duplicate`, `deferred`, or `reconciliation_required`. The SQL reclassifies under
  treasury/identity locks, locks the canonical binding/goal, checks reserved card
  capacity, and writes ledger, contribution, goal and bank receipt together.
  A linked card movement inserts its inflow alias and returns duplicate without
  a second credit. Nonzero/unknown fee economics remain deferred.

## Dedicated SQL privileges

An independently provisioned immutable `prefunded_card.evidence_authorities` row
pins integration, business, database, `ingestion_login`, `reader_login`, NGN and
enabled state. Neither application login may insert its own authority. Both need
only schema USAGE and the listed function EXECUTE privileges; no table privileges,
membership changes, or service-role access are required by this evidence bundle.
The reader must also be the canonical ledger/treasury authorized login for its goal.

Writer statements (parameters in exact order):

```sql
SELECT prefunded_card.evidence_scope($1::uuid,$2::text) AS result;
SELECT prefunded_card.evidence_destination_mapping($1::uuid,$2::text,$3::text) AS result;
SELECT prefunded_card.record_provider_evidence($1::uuid,$2::text,$3::jsonb) AS result;
```

The first two parameters are integration ID and database system identifier; the
third is the observed destination wallet or validated observation JSON.

Reader statements:

```sql
SELECT prefunded_card.read_transfer_evidence($1::uuid,$2::text) AS result;
SELECT prefunded_card.classify_provider_inflow($1::uuid,$2::text,$3::text) AS result;
SELECT prefunded_card.apply_classified_inflow($1::uuid,$2::text,$3::text) AS result;
```

Transfer parameters are operation UUID and database system identifier. Inflow
parameters are integration UUID, system identifier, and authenticated event ID.
Do not grant the internal conflict-fencing or trigger functions to either login.
The successful read function includes the stored operation `request` so the source
adapter validates all internal scope fields before returning provider evidence;
the public `verifyTransfer` result remains only `{ outcome, evidence }`.

The source-only enrolled-wallet branch in `projection-inflow-guard.sql` delegates
when the verified adapter is installed:

```sql
RETURN prefunded_card.apply_verified_legacy_inflow(
  p_provider_transaction_id,p_event_data_id,p_event_id,p_provider_customer_id,p_wallet_id,
  p_amount_kobo,p_fee_kobo,p_reference,p_session_id,p_credited_at);
```

That new security-definer function has the same ten argument types as the existing
public entry. Grant direct EXECUTE only if the dedicated reader catalog needs it;
the owner-defined public wrapper can call it without a direct caller grant. It
requires exactly one enabled database-pinned authority for `session_user`, matches
all raw inputs against persisted verified evidence, and invokes the same atomic
projector. It translates `applied` to legacy `recognized`. Preserve non-enrolled
legacy routing separately; never use it as fallback for deferred enrolled events.

The bank schema accepts an omitted or explicit-null `session_id` without inventing
an identifier. Stored `sessionId` stays null. The ten-argument adapter is explicitly
`CALLED ON NULL INPUT` and compares nullable sessions with `IS DISTINCT FROM`:
null/null matches, while null/string, string/null and null/empty-string refuse.
Event-data identity and timestamp remain required for this adapter. No versioned
signature, statement order, executor grant or role change is needed.

The parent added the enrolled-bank delegation and `evidence-public-route.test.sql`,
which exercises the real public wrapper and canonical projector rather than an
invented stub. Both are source-only changes made during the performance window;
the new regressions have not run. If the verified adapter is absent, the public
wrapper still refuses enrolled inflows rather than falling back to legacy credit.

## Identity and conflict handling

The captured `inflow_transaction` bank shape has `type: inter`,
`status: COMPLETED`, and no `source_wallet_id`. The schema now accepts that exact
pair without manufacturing the omitted field. It also retains the older
`type: inflow`, `status: success`, explicit-empty-source shape. Mixed status pairs
or a nonempty webhook source are refused. Both require a positive
`bank_transfer_inflow` category and zero fee. Independent authenticated transaction
evidence must report successful status and matching amount/reference. The older
`bank_transfer_inflow` summary requires an empty source and matching customer.
The observed `bank-inflow` summary instead requires the exact business as customer,
the envelope wallet as credited source, and an empty destination. Both paths require
independent ownership checks and retain the original mapped webhook customer.
A captured-shaped webhook alone never authorizes credit.
Envelope PVB IDs and inner provider IDs are not assumed identical. New captured-
shape schema/ingestion regression tests are written but not run during the window.

Internal transfer identity comes from the authenticated single-transaction lookup;
amount is corroborated by TSQ. The sender/transaction `customer_id` is not reused as
the destination customer. Destination ownership comes from the provisioned mapping
and an authenticated customer-filtered wallet list containing the exact wallet.
When the retrieved wallet supplies `api_customer_id`, use that verified API alias
for the filter and corroborate it on the list entry. It is not the webhook customer
UUID and must not replace the customer in the internal mapping.
Each ingestion performs at most four bounded GETs, with no polling or sends.

Reference collisions include provider transaction IDs, merchant, internal, peer,
session and collection references. Later bridge reservations/aliases cannot consume
an already-attributed bank identity. Conflict recording locks treasury then operation,
matching projection order, and fences unapplied operations as
`reconciliation_required`. Applied money remains unchanged with a durable entry in
`evidence_conflicts` / `bank_evidence_conflicts` for reconciliation.

## Verification and remaining integration

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/staging/prefunded-card/evidence-local.test.py
pnpm --dir apps/web exec vitest run src/lib/piggyvest/prefunded-card-provider-evidence.test.ts src/lib/piggyvest/prefunded-card-provider-evidence-normalize.test.ts src/lib/piggyvest/prefunded-card-provider-evidence-reader.test.ts src/schemas/prefunded-card-provider-evidence.test.ts
```

The local harness clears inherited PG variables through the shared fixture, binds
only a disposable Unix socket, and covers roles, mapping, duplicate ingestion,
parallel classification/projection, controlled conflict-before-project blocking,
after-applied obligations, real mixed bank/card credits, raw-input refusal, forced
contribution failure rollback and restart durability. Parent owns existing
inflow-wrapper integration, runtime composition and the dedicated executor.
The authenticated ingestion factory is not yet connected to the actual public
webhook receipt scheduler. This work is not deployed.

Parent has added the code-only `createPrefundedCardReceiptReplay` adapter with
separate ingestion and ledger executors. It authenticates original bytes through
`ingest`, then calls `applyInflow(eventId)` for stored bank evidence; SQL rechecks
classification before credit. Deferred results request retry, conflicts request
reconciliation, storage failures throw, and outflows do not trigger bank credit.
This is the composition seam, not a running scheduler or public-intake hookup.
Its source was read during the code-only window; its tests were not run here.

Live gates: independently provisioned authorities/credentials, real signed-byte
vectors and replay delivery, provider wallet-list identity linkage and paging
(missing destination on the single bounded page defers), actual staging transaction
evidence/settlement, fee economics for nonzero fees, and reconciliation/reversal
operations. Conflicting or incomplete evidence remains deferred/reconciliation work.

Contracts reviewed: [single transaction](https://www.piggyvestbusiness.com/docs/api/transactions/single),
[TSQ](https://www.piggyvestbusiness.com/docs/api/transfers/status),
[wallet detail](https://www.piggyvestbusiness.com/docs/api/wallet/retrieve),
[customer-filtered wallets](https://www.piggyvestbusiness.com/docs/api/wallet/list),
[webhook envelope](https://www.piggyvestbusiness.com/docs/webhooks/payload),
[event names](https://www.piggyvestbusiness.com/docs/webhooks/events), and
[signature](https://www.piggyvestbusiness.com/docs/webhooks/signature).

## Exact changed paths

All paths below are new files in `/Users/mac/Baci-worktrees/cursor-savings-phase1`.
No existing provider, runtime, projection, executor, migration, or environment file
was edited by this lane. Initial dirty-state inventory is preserved in
`/private/tmp/prefunded-evidence-baseline-HHGTum/dirty-status.txt`.

```text
apps/web/src/lib/piggyvest/prefunded-card-provider-evidence.ts
apps/web/src/lib/piggyvest/prefunded-card-provider-evidence.test.ts
apps/web/src/lib/piggyvest/prefunded-card-provider-evidence-normalize.ts
apps/web/src/lib/piggyvest/prefunded-card-provider-evidence-normalize.test.ts
apps/web/src/lib/piggyvest/prefunded-card-provider-evidence-reader.test.ts
apps/web/src/schemas/prefunded-card-provider-evidence.ts
apps/web/src/schemas/prefunded-card-provider-evidence.test.ts
tools/staging/prefunded-card/evidence-storage.sql
tools/staging/prefunded-card/evidence-record.sql
tools/staging/prefunded-card/evidence-transfer.sql
tools/staging/prefunded-card/evidence-inflow.sql
tools/staging/prefunded-card/evidence-conflict.sql
tools/staging/prefunded-card/evidence-projection-storage.sql
tools/staging/prefunded-card/evidence-projection.sql
tools/staging/prefunded-card/evidence-legacy.sql
tools/staging/prefunded-card/evidence-fixture.sql
tools/staging/prefunded-card/evidence.test.sql
tools/staging/prefunded-card/evidence-projection.test.sql
tools/staging/prefunded-card/evidence-legacy.test.sql
tools/staging/prefunded-card/evidence-local.test.py
tools/staging/prefunded-card/evidence-contract.md
```

Historical validation before the nullable-session correction: 44 Vitest tests across the four evidence test files;
focused Biome check of all seven TypeScript files; `pnpm --dir apps/web exec tsc
--noEmit --pretty false`; and the disposable SQL harness, also with synthetic
`PGHOSTADDR`, `PGSERVICE` and `PGOPTIONS` overrides to prove inherited libpq
settings are cleared. All passed. No broader workspace tests or live actions ran.

## Nullable-session correction: validation deferred

During the exclusive performance window, only file reads and patches were made.
No tests, typechecks, formatters, builds, installs, watchers or cleanup ran. The new
regressions have not been executed; neither red nor green is claimed for this patch.
The prior six modified files were preserved under
`/private/tmp/prefunded-evidence-null-session-1790447754293-0xarb5`.

Added coverage includes the captured bank-event shape with distinct envelope/inner
wallets, event-data ID, timestamp, and absent/null session; malformed-session
rejection; direct-projector-first and adapter-first deduplication; and refusal of
invented/erased sessions or missing event-data identity/timestamp without writes.
The private harness loads `evidence-legacy.test.sql` before its mixed bank/card race.

Exact paths changed in this correction (relative to the savings worktree):

```text
apps/web/src/lib/piggyvest/prefunded-card-provider-evidence.test.ts
apps/web/src/schemas/prefunded-card-provider-evidence.ts
apps/web/src/schemas/prefunded-card-provider-evidence.test.ts
tools/staging/prefunded-card/evidence-legacy.sql
tools/staging/prefunded-card/evidence-legacy.test.sql
tools/staging/prefunded-card/evidence-local.test.py
tools/staging/prefunded-card/evidence-contract.md
```

Deferred commands, from the savings worktree root after explicit release:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/staging/prefunded-card/evidence-local.test.py
pnpm --dir apps/web exec vitest run src/lib/piggyvest/prefunded-card-provider-evidence.test.ts src/lib/piggyvest/prefunded-card-provider-evidence-normalize.test.ts src/lib/piggyvest/prefunded-card-provider-evidence-reader.test.ts src/schemas/prefunded-card-provider-evidence.test.ts src/lib/piggyvest/prefunded-card-receipt-replay.test.ts
pnpm --dir apps/web exec biome check src/lib/piggyvest/prefunded-card-provider-evidence.test.ts src/schemas/prefunded-card-provider-evidence.ts src/schemas/prefunded-card-provider-evidence.test.ts
pnpm --dir apps/web exec tsc --noEmit --pretty false
```
