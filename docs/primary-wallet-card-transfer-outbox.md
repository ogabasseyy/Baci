# Connected bounded primary-card financial outbox worker

Source/mock/isolated PostgreSQL only. No migrations were applied remotely, provider
requests sent, settings/credentials provisioned, artifacts installed or timer enabled.

## Actual runnable connection

`tools/staging/primary-wallet-card-transfer/primary-wallet-card-transfer-entry.ts`
launches `primaryCardTransferCli` → `runPrimaryCardTransferOutbox` → restricted
`select_ready_transfers` → **existing `dispatchPrimaryCardProviderTransfer`** →
immutable scoped context/committed claim → actual documented HTTP adapter → durable
submitted/unknown result. The local package builder outputs `transfer.cjs` and
systemd financial-worker oneshot/timer templates. No parent source hook is missing
for launching this financial dispatcher. Parent's signed PiggyVest webhook already
feeds durable receipt intake; receipt settlement runs under a different role/package.

New appended migration `20261007201300_primary_card_transfer_outbox_selector.sql`
grants just the fixed selector RPC to `primary_card_transfer_worker`; generic,
authorizer, collection-evidence, signed-intake and custody roles cannot call it.
No table grants/new roles/elevated login were added. Existing frozen `201200` and
all earlier registered migration bytes are unchanged.

Selection is bounded to zero for readiness or one for once. It validates current
integration/environment/expiry, exact approved capability and owner-selected treasury
snapshot/identity. Only collected custody-pending operations with ready outbox,
reserved matching treasury and verified customer/user/wallet mapping qualify.
Selection does not mutate/claim or lease. Existing autocommitted locked `claim_transfer`
fences overlapping selectors/workers: one attempt, one reference, no reclaim of
dispatching/submitted/unknown/completed. Claim rechecks treasury immediately before HTTP.

## Typed worker outcomes and process contract

All results include `fundingComplete:false` and only counts/status, never provider
responses, credentials, customer identity or operation IDs:

- `approved_policy_and_storage_ready`: read-only zero-selection preflight, exit 0.
- `idle`: no ready operation, exit 0; not wallet funding or custody completion.
- `raced`: another worker claimed the selected operation, exit 0; no second POST.
- `submitted_for_custody`: accepted provider envelope, exit 0; custody still pending.
- `reconciliation_required`: durable unknown or unresolved dispatching backlog, exit 2.
  New dispatch stops integration-wide until reconciliation; scheduled inspection never
  retries financial HTTP. Operational/configuration/storage/invalid-ack failures exit 1
  with redacted stderr rather than acknowledging successful deferred handling.

## Remaining external versus code prerequisites

Parent must register/apply `201300`, authorize isolated transfer login/TLS/API credential
scope/current deployment expiry and install/activate reviewed templates. Trusted runtime
must carry approved signed **reusable** contract policy, exact business/integration/
merchant/environment and treasury-webhook/transaction customer namespace evidence.
Actual exhaustive bank/internal alias contract/evidence is still absent. No guessed
endpoint, alias extractor, approval flags or per-operation selection files replace it.

Financial selection uses verified DB onboarding for future customer payments; it no
longer requires owner-authored operation ID files. Signed custody completion still
needs approved authenticated single-transaction crosswalk plus complete bank/internal
aliases. The current receipt package's operation-record delivery needs an approved
reusable authenticated reader binding/extractor after the provider contract is supplied.
Collection success and HTTP acceptance alone never credit the wallet. Signed settlement
shares exact-once ledger identity with bank inflow. Legacy funds and all economic limits
remain unchanged. This closes source selector/launch wiring, not live financial funding.

## Prior selector package evidence (superseded by cancellation fix below)

- Focused card node Vitest: 320 tests / 40 files passed; CLI/entry: 5 tests / 2 files.
- Standalone package/storage Node tests: 3 passed, including two parallel PostgreSQL
  claim sessions with exactly one claimed result, unknown never reclaimed, signed
  recovery duplicate protection, scope/grants/expiry/mapping/stale-treasury rejection.
  Imported fixtures also verify bank-before/after-custody shared credit identity.
  All isolated clusters stopped; no remote database was used.
- Full own scoped Biome: 100 files clean. Card-only and transfer-tool TypeScript
  checks passed with 1 GB heap; no broad web validation was run.
- Review-only artifact: `/tmp/baci-primary-card-transfer-final.wgTyyLHn/package`.

```text
201300 migration SHA-256
ee49e5ed5f5b3966f2305a9b057cd971260c47553d9faf952b843c786d54e69a
transfer.cjs SHA-256
c0a4a36a77a968e056f1a9e7df3777e78dbe0afa9a311df1bdaedfc2a3acadec
artifact.manifest.json SHA-256
3bb7ff48b4cd9d4cdffeee0cde66a11edc7d5efa464b5854298bca5d5a6790f9
service template SHA-256
615c3a927ab212595b22073e5cec2e6a548b4bfb177bab79e5d9ebcca0d9eeca
timer template SHA-256
b70dfea8d6305b5955d1c1f737c1ec9356b6206caebfd445194626932dd5f751
```

Manifest explicitly records `activated:false`, `providerWritesPerformed:false`,
`financialTransportIncluded:true`, `autonomousFundingReady:false`, reviewed source
closure and frozen migration hashes. Neither compilation nor these tests installed
or launched a configured financial worker. Treasury snapshot refresh remains an
independent approved operator/provider evidence binding, not a guessed financial call.

## Cancellation fix — final reviewed source package

The outbox forwards its signal through the dispatcher into the actual transfer
connection. Cancellation during awaited context lookup rejects before claim.
Cancellation after committed claim is fenced at the actual fetch delegation;
the existing driver records unknown, never resets/releases the attempt. A failed
result write propagates and leaves dispatching; later runs require reconciliation
without another POST. Already-started HTTP retains the existing bounded deadline.

Two exact regressions first failed by incorrectly submitting, then passed. Final
focused transfer validation: 47 tests / 7 files, CLI/entry 5 tests / 2 files, package
and isolated PostgreSQL 3 tests; both scoped TypeScript checks and full own scoped
Biome (100 files) passed. Frozen 201300 bytes/hash remain unchanged.

Use `/tmp/baci-primary-card-transfer-abort-final.2aPpZqE5/package` instead of the
prior artifact. `transfer.cjs` SHA-256:
`6466f1d4c6bb30888df24cd9192610ad986acce9dffb6dde7197721620b4ab27`.
Manifest SHA-256:
`8b8eee89b35202165508cffdd42e19824828acde64726bf2b20f73fea7037b70`.
No installation, activation, remote changes or provider writes occurred.
