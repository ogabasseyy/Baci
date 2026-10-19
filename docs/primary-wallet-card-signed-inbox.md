# Primary card signed intake and durable worker hookup

Local source/mocked HTTP/isolated PostgreSQL only. No shared webhook route, migration registry, mobile, provisioning, registered migration bytes, remote configuration, credentials or provider financial transport was changed. This connects concrete intake and worker storage; it does not activate customer funding or supply missing provider crosswalk evidence.

## Parent-facing primary intake export

Follow-up operator package: `tools/staging/primary-wallet-card-custody/README.md` documents the executable worker/scheduler artifact and new `201100` role split. Intake now uses `baci_primary_card_intake` with `PIGGYVEST_PRIMARY_CARD_INTAKE_PASSWORD` and separately expiring owner-enabled DB authority; there is no fallback to custody settlement credentials. Parent reports the shared signature-verified webhook hook is now connected. The statements below describing pending parent hookup were the prior handoff, not a claim that current role provisioning or worker deployment has happened.

Import `dispatchPrimaryCardSignedCustodyIntake` from `apps/web/src/lib/piggyvest/primary-wallet-card-custody-intake-dispatch.ts`.

It reads current trusted intake configuration, constructs the existing restricted PostgreSQL executor under an **intake-only** statement profile, verifies exact bounded signed bytes, checks database capability/owner source routing and commits the private raw-byte inbox. It needs **no crosswalk callback, provider API token, transfer password, batch size or financial adapter**. Signature/customer/contract identities, custody database credentials and current scope/deadline remain required. The intake profile permits only readiness/enqueue; claiming, settlement and transfer SQL are rejected before connection.

The explicit typed result is `{ outcome, response }`:

| Outcome | Response | Meaning |
| --- | --- | --- |
| `accepted`, `duplicate` | 200, `custodyQueued: true` | Exact signed receipt durably recorded/deduplicated; **not collection or funding completion**. |
| `conflict` | 200, `quarantined: true` | Alternate signed bytes durably retained in the conflict table; original bytes unchanged, no custody processing of the alternate. |
| `not_ready`, `invalid_signature`, `invalid_payload`, `storage_unavailable` | 503, sanitized error | No successful unrecorded/deferred acknowledgement and no legacy fallback. |
| `not_handled` | `null` | Active configured signature/routing checks positively identify an unrelated type/customer/source. |
| `disabled` | `null` | Explicit `SIGNED_INBOX_ENABLED=false`, valid bounded envelope and no owned canonical customer or primary reference claim. |

Missing/expired/incomplete configuration is not `disabled`. Even explicit disable cannot drop a known primary transfer family, matching canonical treasury customer, or wallet-transfer delivery whose canonical customer configuration is missing. `deferred` is **not** an intake outcome. Disabled classification is non-authoritative and must be used only inside the parent's already signature-verified route; it never authorizes receipt processing or credit.

Minimal parent PiggyVest hook: after existing bounded-byte/global-signature verification and successful JSON decoding, **before full event-schema quarantine, generic outflow inbox processing or legacy service-client construction**, inspect the bounded generic envelope's `eventType`. Only for `wallet-transfer.outflow.success`:

```ts
const primaryCard = await dispatchPrimaryCardSignedCustodyIntake({
  rawBody,
  signature,
});
if (primaryCard.response) return primaryCard.response;
```

Use the existing bounded envelope schema for classification, not a guessed event-data reference. Only the two null outcomes allow existing processing to continue. The helper re-verifies the configured integration signature and never constructs a service-role client. The route insertion is intentionally left to the parent; this task does not edit either shared webhook route. Shared Paystack routing remains parent's ownership and must continue preventing primary references/metadata from legacy credit.

## Explicit capability/readiness

New migration `20261007200900_primary_card_signed_inbox.sql` creates private RLS-denied `inbox_capabilities`, `signed_inbox` and `signed_inbox_conflicts`, with function-only custody capability access. Owner capability rows default **disabled**. They pin approved crosswalk contract/issuer, canonical source webhook customer and authenticated transaction customer, plus these internal profile labels:

- `wallet-transfer-outflow-v1`: the already documented signed `eventId`, `eventType`, `eventCategory`, `customer_id`, `pvb_wallet`, `pvb_reference` envelope, retaining original bytes/signature rather than redacted details.
- `single-transaction-third-party-reference-v1`: the documented authenticated single-transaction `third_party_reference` equals the exact stored deterministic primary transfer reference. These are internal capability assertions, **not claimed provider-published version names**.

Runtime `PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED=true`, `SIGNED_PAYLOAD_CONTRACT`, `SIGNED_MAPPING_CONTRACT` must match the approved profiles. The intake-only reader requires the existing custody-enabled integration/environment/merchant/business/expiry/canonical-customer/issuer/database/signature settings, but not financial/provider-read credentials. Worker runtime additionally requires provider read credentials, configured crosswalk delivery, transfer runtime profile and `SIGNED_BATCH_SIZE` from 1–10. No values were provisioned or printed.

`signed_inbox_readiness` compares runtime capability to independently configured DB identities/settings/deadline and discovers the owner-selected source wallet under the dedicated login. An unmatched/unprovisioned capability is unavailable, not an inferred mapping. New checkout insertion/collection dispatch and transfer dispatch are also gated on an enabled DB signed-inbox capability. Existing captured operations remain stored; no cancellation or financial release is inferred from disablement.

## Durable receipt worker

`createPrimaryCardCustodyInbox` concretely composes the existing executor, raw-byte intake, exact authenticated lookup, signed proof verifier/reader and leased worker. For the configured worker/scheduler entry, use `createPrimaryCardCustodySignedRuntime` and await `runWorker(signal)`. **Only this worker factory needs** `resolveAuthenticatedCrosswalk`; intake uses the standalone dispatcher above.

No financial adapter is required or implemented. Worker provider requests are bounded authenticated **GETs only**:

1. Retrieve `/api/v1/transaction/<signed pvb_reference>?wallet_id=<owner source>`; require exact canonical ID/source/configured transaction customer, successful `wallet_transfer` and a primary-family `third_party_reference`. Missing/mismatching fields do not fall back to `reference`, `internal_reference`, goal IDs, UUID extraction from unrelated provider IDs or equal amounts.
2. Resolve that **exact stored** third-party reference under integration/environment/owner source, reservation and dispatched outbox scope. Only pending/completed primary operations match.
3. Invoke the already implemented signed custody boundary with independently authenticated single/TSQ/source/destination observations and approved exhaustive customer/transaction-alias crosswalk. Settlement is still the existing atomic primary ledger/treasury path.

New migration `20261007201000_primary_card_signed_inbox_worker.sql` provides batch claims with row locks/SKIP LOCKED, 60-second token-fenced leases, bounded retries, exact operation lookup and finish fencing. `processing` crashes can be reclaimed after lease expiry. `completed`/`duplicate` receipts become `processed` only when a committed signed custody observation exists for **that integration/event/body digest**. A wrapper records validated original/replay observations atomically with the retained ledger settlement function; registered `20261007200700` bytes are unchanged. A crash after ledger settlement but before inbox finish safely replays as duplicate without another credit/debit.

Provider, lookup, context, settlement and invalid-acknowledgement errors persist `io_retry` where possible and **fail the worker**. Failed retry persistence/finish also propagates; it never reports successful deferred receipt processing. Unmapped/incomplete evidence remains pending with a bounded delay. Conflicting proof and 50-attempt exhaustion become retained `blocked` receipts requiring operator review, not discarded/processed records. There is no automatic reset, refund, release, replenishment or second transfer.

## Provider evidence and remaining actual hookup gates

Approved environment-specific signed samples and authenticated API evidence must establish the exact canonical source webhook customer, transaction customer, owner source, canonical transaction ID and `third_party_reference` behavior. The customer crosswalk must prove destination public wallet/API customer/canonical webhook customer ownership and **all** corresponding signed bank-inflow transaction IDs, with configured issuer/contract, provenance and fresh expiry. A supplied callback/object label alone is not provider authentication. Actual approved mappings/issuer delivery are not present in this source task.

Parent still must register the new final migration hashes, provision the constrained capability/configuration, insert the PiggyVest intake hook, schedule the durable worker, supply approved crosswalk delivery and monitor/recover blocked/expired/key-rotation receipts. Intake can be hooked without that callback, but collection/funding must remain disabled until the worker and proof prerequisites are ready. Raw receipt retention/encryption/rotation and operator requeue policy need explicit operational ownership.

Bank-before-proof deferral still uses the existing primary ledger's safe `conflict` outcome. The parent must not classify this temporary custody dependency as an irrecoverable drop: preserve signed bank bytes in a retryable inbox or use retryable delivery rather than only redacted quarantine. This new intake owns internal wallet-transfer custody receipts, not a guessed bank-to-card attribution. Existing alias deduplication prevents later bank/card duplicate credit once approved custody aliases are installed; unrelated deferred bank deposits need the parent bank replay path.

Completion notification/cache outbox dispatch, Paystack collection/settlement receivable reconciliation, treasury replenishment/refund/chargeback operations, financial transfer submission and mobile UI wiring remain separate gates. None is claimed by `custodyQueued`, worker receipt acknowledgement or this handoff. Legacy funds/owner ceilings remain preserved.

## Local validation and stable migration hashes

Focused card Vitest, scoped Biome and the isolated card-only TypeScript config are run locally; no broad web validation is repeated. The old false-ack mock was widened to `Promise<unknown>` and runtime test environments now explicitly satisfy `NodeJS.ProcessEnv` with `NODE_ENV: test`. The reported non-null assertion was removed with runtime signature narrowing; the typecheck JSON is Biome formatted.

Final focused result: **213 tests passed across 28 files**, scoped Biome checks **38 files**, and the card-only TypeScript check passed with a 1 GB heap. The isolated PostgreSQL regression fixture passed; no remote database or provider actions were performed.

`primary-wallet-card-custody-inbox.integration.sql` applies the held custody fixture plus the two new append migrations in a fresh local Unix-socket-only cluster. It tests absent/mismatched capability, original-byte dedupe, durable alternate conflicts, lease fencing/reclaim, retry persistence, exact mapping, no inbox completion without a custody ledger observation, new-event duplicate settlement, crash-after-settlement replay, bank-alias duplicate credit avoidance and retained attempt exhaustion. The PostgreSQL fixture uses synthetic headers to test storage capabilities; HMAC verification is independently exercised by the mocked signed-intake/worker tests.

Stable SHA-256 values for parent registration:

```text
20261007200900_primary_card_signed_inbox.sql
f024431b7bcaae85e77e058031f8d83676afeb796b70401310368d5fc202c90b
20261007201000_primary_card_signed_inbox_worker.sql
bfa7e7af160fab3a6ef8b52f6045e18296bc1457d9593d79b001b92ef4e72d7b
```

The parent-registered `20261007200300`–`20261007200800` migrations were not rewritten in this follow-up.
