# Primary-card financial transfer adapter — source/mock/local PG only

The named transport gap is now implemented as actual code, **not live-enabled, scheduled or exercised against a provider**. No remote configuration, credentials, provider write, real transaction, migration registry, shared webhook, bank module, provisioning, mobile, refund or chargeback logic was changed. Previously registered `200900`/`201000`/`201100` bytes remain unchanged.

## Concrete primary export and durable connection

Trusted financial worker entry: `dispatchPrimaryCardProviderTransfer` in `apps/web/src/lib/piggyvest/primary-wallet-card-transfer-dispatch.ts`. It reads current deployment configuration and approved policy, constructs the restricted executor and actual provider adapter, then dispatches the supplied **durable outbox operation ID**. It requires no caller-injected financial callback and must not be exposed as a customer-selected unauthenticated API.

The concrete chain is:

```text
dispatchPrimaryCardProviderTransfer
  -> readPrimaryCardTransferRuntime / authenticated reusable-contract policy
  -> createPrimaryCardTransferConnection
  -> restricted dispatch_context (verified DB ownership + approved contract scope)
  -> existing runPrimaryCardTransfer
  -> committed claim_transfer: ready -> dispatching / immutable token + command
  -> createPrimaryCardTransferProvider: one exact bounded authenticated POST
  -> record_transfer: submitted or unknown (never wallet credit)
```

The claim uses an autocommitted restricted PostgreSQL statement and must return before HTTP. No request is sent for existing durable claims. A transport error, auth failure, redirect, malformed response, negative provider envelope or lost acceptance is persisted as `unknown`; capacity stays held and the same operation cannot claim another attempt. A lost result write or false acknowledgement fails the worker; the existing `dispatching` claim remains non-reclaimable for another financial POST. No new reference or second attempt is generated. Wrong claimed source/destination/amount/reference cannot pass the adapter's independent scoped-context comparison; the old combined connection now applies the same check (regression first failed, then passed).

`submitted` means the HTTP acceptance envelope has `status=true`, including the documented 202 processing shape. It is **not** completed custody, settled collection, primary-wallet credit or spendable funding. Recovery uses the existing signed custody inbox/independent GET observations and exact original deterministic reference, not a new POST. Frozen settlement SQL accepts valid proof for `dispatching`, `submitted` or `unknown` and retains exactly-once bank/card identity protections.

## Provider request — no guessed route or fields

The request uses existing `requestPrefundedCardProviderJson` transport mechanics: Bearer auth, no-store, redirect rejection, bounded 64 KiB JSON response, 5-second request/body deadline and **no retry**. It copies the documented wallet-transfer request already implemented in `transfers.ts` and `prefunded-card-provider.ts`:

```text
POST <getPrimaryWalletProviderOrigin(durableContext.environment)>/api/v1/transfer/wallet
JSON: amount (integer kobo), source, destination, currency="NGN", reference
```

All five fields come from the validated immutable claimed command and must equal independently loaded durable operation/reservation context. No narration, goal, savings ID, Paystack authorization, legacy balance, client-selected destination or inferred provider field is inserted. Staging explicitly uses `https://staging.piggyvest.business`; production requires matching durable production context and uses `https://api.piggyvest.business`. The token-only `transferToWallet` production default is not used.

## Restricted financial profile and append migration

New `20261007201200_primary_card_transfer_dispatch_context.sql` grants only the read-context projection to `primary_card_transfer_worker`; it validates the existing worker actor/settings/expiry, exact runtime contract/issuer/customer IDs against independently enabled DB inbox capability, and scoped verified primary-wallet/customer mapping. Its four-argument function requires exact integration/environment/operation/capability, not body-selected tenant authority. It does not edit provisioning, existing migrations, treasury limits or ledger balances.

The executor's `transferOnly` profile permits only `dispatchContext`, `claim` and `record`, with strict TLS and `baci_primary_card_transfer` / `primary_card_transfer_worker`. It rejects custody settlement, signed inbox intake and all other statements before connection. Financial runtime excludes custody credentials, webhook secret and intake credentials; the trusted environment reader rejects mixed custody/intake passwords. No service-role client or service-role grants are introduced.

## Live gate is still closed on actual crosswalk proof

Runtime requires current integration/environment/merchant/business/expiry and dedicated transfer database/API credentials; existing custody/inbox enable flags; `PIGGYVEST_PRIMARY_CARD_TRANSFER_PROVIDER_ENABLED=true`; and all three `PIGGYVEST_PRIMARY_CARD_TRANSFER_POLICY_BYTES`, `TRANSFER_POLICY_SIGNATURE`, `TRANSFER_POLICY_ISSUER_KEY` settings. None was provisioned or read from an environment file here.

The exact policy bytes must pass HMAC-SHA256 under an independently configured approved issuer delivery key, strict policy schema and current scope/expiry. It must assert `authority=approved_reusable_primary_card_transfer_contract`, `transferEnabled=true`, `reusableBindingReady=true`, `exhaustiveAliasContractApproved=true`, approved evidence SHA-256 and the same configured provider contract/issuer/canonical customer namespaces. Policy expiry cannot exceed current runtime/database expiry; mismatched DB contract scope fails before claim/HTTP. The source/readiness worker's `operation_records_only`, `reusableBindingReady=false` result **cannot** authorize this adapter.

This is an **internal approval-delivery contract, not a new PiggyVest endpoint/signature or proof that aliases are known simply because a JSON flag is true**. Only an approved issuer that has vetted actual provider evidence may issue it. Self-signing guessed aliases or changing flags is not deployment approval. The reusable provider alias contract and exact wallet/API/webhook customer namespace evidence identified in the operator runbook remain absent from this source task; therefore no real policy or live activation is claimed. Per-operation signed custody proof remains mandatory before wallet credit regardless of HTTP acceptance.

## Minimal parent financial worker hook and remaining bindings

After a verified collection has durably created its reservation/ready transfer outbox, the separately restricted financial worker may invoke `await dispatchPrimaryCardProviderTransfer({ operationId: durableOutboxOperationId })`. Do not call it before durable collection/reservation, inject a browser destination, put transfer credentials in the signed receipt worker, or treat its return value as completion. Existing DB claim/treasury/capability guards fail closed. The signed custody scheduler intentionally remains a separate GET/settlement process.

The bounded selector/scheduler source connection is now implemented in `primary-wallet-card-transfer-outbox.ts` and the standalone financial oneshot package at `tools/staging/primary-wallet-card-transfer/`. See `docs/primary-wallet-card-transfer-outbox.md`. Parent registered frozen `201200`; new selector migration `201300` requires registration and authorized application. Still external: provision isolated credentials/current expiry, approve the actual reusable provider alias contract and authenticated policy delivery, then review/install/activate the package. No remote API/auth smoke or financial action was performed. Receipt-worker reusable authenticated alias delivery remains a separate binding gap; bank raw retry remains the other assigned lane.

## Final validation and stable migration bytes

Focused node Vitest: **326 tests / 42 files passed**, including exact mocked 202 POST/auth/body/origin, claim-before-HTTP, 401/403/500/redirect, lost-after-send, negative/malformed acknowledgement, wrong destination/context, lost storage acknowledgement with no second dispatch, disabled/expired/forged/static approval and existing signed-custody/checkout regression suites. Both staging and matching durable production origins are tested.

Own full scoped Biome: **95 files clean**. Card-only TypeScript passed with a 1 GB heap; no broad web check was rerun. Existing standalone receipt package tests still pass **2/2**, and its tool-entry scoped TypeScript check passes; those artifacts do not launch this financial adapter.

Fresh Unix-socket-only PostgreSQL fixture passed and cluster stopped: restricted financial role obtains exact verified context; rejects wrong environment/contract and custody/intake/generic grants; `unknown` and simulated stranded `dispatching` are never re-claimed. Existing collection/custody/bank exact-once fixtures also execute. Synthetic mocks/PG fixtures establish source behavior, not real provider acceptance or a live funded wallet.

Stable new migration SHA-256 for parent registration:

```text
20261007201200_primary_card_transfer_dispatch_context.sql
654a00a5fd3bf00654a618d2025cb848e22f65abc2f85f58f26a20ba529322c3
```
