# PiggyVest staging contract register

## Scope

This Task 2 boundary retrieves one known Business Wallet from the fixed staging
origin. It is server-only, accepts an explicit injected configuration, and has
no environment lookup, write operation, retry loop, webhook registration, or
provider call in tests.

## Confirmed public contract

| Area | Evidence | Implemented boundary |
| --- | --- | --- |
| Authentication | [Authentication](https://www.piggyvestbusiness.com/docs/authentication) documents a Bearer secret key. | Sends the injected secret only as the GET `Authorization` header. |
| Wallet lookup | [Retrieve wallet](https://www.piggyvestbusiness.com/docs/api/wallet/retrieve) documents `GET /api/v1/wallet/:wallet_id`. | Calls only `https://staging.piggyvest.business/api/v1/wallet/:wallet_id`, with redirects rejected. |
| Response envelope | The retrieve-wallet page documents `status: true` and wallet `data` including `id`, `business_id`, `currency`, `balance`, and `status`. | Projects only these fields, validates the requested wallet ID, expected business ID, expected currency, finite numeric balance, and string status. |

## Safety limits

- The timeout and response-body limit are explicit, bounded configuration values.
- Provider and transport failures expose only a stable internal code; credentials and response bodies are not included.
- The client retains the numeric provider balance without inferring its units, available funds, or spendability.
- The client makes exactly one read request and never performs retries or writes.

## Provider gaps to resolve before activation

- Webhook documentation describes SHA512 hex signatures over `JSON.stringify`, while a secure receiver needs an exact raw-byte contract and provider test vector.
- The public API documentation describes an always-200 pattern but does not define a durable-outage or redelivery policy.
- The transaction-list row `amount` is explicitly documented in kobo. That does
  not establish units for wallet balances, accrued interest, single-transaction
  fee/balance/breakdown fields, or financial webhook payloads. Event linkage and
  settlement rules remain separate contracts; no blanket unknown-units gate
  applies to the documented transaction-list amount.

## Offline intake extension

The common [webhook envelope](https://www.piggyvestbusiness.com/docs/webhooks/payload)
and [signature documentation](https://www.piggyvestbusiness.com/docs/webhooks/signature)
were rechecked on 12 September 2026. A bounded raw-byte intake library, private
PostgreSQL inbox and quarantine-only worker are now being verified locally.
They are not wired into the public registration endpoint. Unknown and known
financial event names alike remain unsupported for accounting.

`docs/piggyvest-inbox-local.md` defines executor durability, role separation,
raw-payload retention and the remaining serialization/acknowledgement gates.

## Provisioning contracts rechecked, 12 September 2026

- [Create customer](https://www.piggyvestbusiness.com/docs/api/customers/create):
  `POST /api/v1/customers` requires BVN, email, name and phone. BVN is mandatory
  and exactly 11 digits; optional identity fields do not replace it. Creation
  also generates a default wallet. Success returns customer ID, wallet ID and
  `new_customer`; there is no customer-record webhook. `returnIfExist` is a
  documented matching behavior, not evidence of general mutation idempotency.
  Obtain approved synthetic identity fixtures before any sandbox provisioning.
- [Create wallet](https://www.piggyvestbusiness.com/docs/api/wallet/create):
  `POST /api/v1/wallet/sub-account` creates an additional customer wallet.
  The documented name, virtual-account choice and customer ID belong in the
  server-owned plan provisioning intent. A successful response supplies an ID
  but creation is asynchronous: do not treat HTTP 200 as a ready/funded wallet.
  Verify readiness through the documented webhook or ID lookup. Do not set
  interest-routing options from customer-supplied wallet IDs.
- [Funding account](https://www.piggyvestbusiness.com/docs/api/wallet/funding):
  `GET /api/v1/wallet/:wallet_id/accounts` supplies virtual-account details.
  This confirms a documented funding channel, not deposit fees or guaranteed
  availability. Verify ownership before retrieval or display; account details
  must not enter logs. No funding-account API has been called in this batch.

Local provisioning builders, durable intents, single-dispatch fencing and
provenance-backed recovery adapters now exist and have synthetic tests. No
provider resource creation is established by those tests. Dispatch must still
follow a committed intent, and uncertain results must reconcile before another
attempt. Do not create a new API customer for every savings plan.

## Additional reconciliation research, 12 September 2026

- [Single transaction](https://www.piggyvestbusiness.com/docs/api/transactions/single)
  documents `GET /api/v1/transaction/:transaction_id` and an optional `wallet_id`
  ownership filter. Its response includes transaction status, source/destination
  wallets, customer identity, amount, fee and interest payout breakdown. This is
  a concrete basis for a future strict reconciliation adapter; do not claim the
  financial response shape is entirely absent. This endpoint's amount units, category meanings
  and event-to-transaction linkage still need explicit validation before posting
  ledger effects.
- [Fetch customers](https://www.piggyvestbusiness.com/docs/api/customers/fetch)
  provides filters for customer ID and `third_party_identifier`, useful for an
  uncertain provisioning result. Its response is described only as a paginated
  list; do not invent the missing customer projection or automatically recreate
  the customer after an empty/unverified lookup.
- [Test funding](https://www.piggyvestbusiness.com/docs/api/funding) explicitly
  specifies integer kobo inputs and a stated NGN 100,000 per-call maximum.
  The displayed example exceeds that stated maximum and no concrete success
  envelope is shown. Do not copy the example amount or infer financial finality
  from HTTP 200. This endpoint has not been invoked.
- [Accrued interest](https://www.piggyvestbusiness.com/docs/api/wallet/interest)
  documents paginated accrual records and monthly payout timing, but an accrual
  read is not evidence of a paid, reconciled customer entitlement. Its withdrawal
  wording must not silently replace the already approved per-plan architecture
  or establish an undocumented cancellation/refund mechanism.

## Wallet-scoped transaction list observation

[List transactions](https://www.piggyvestbusiness.com/docs/api/transactions)
documents the singular `GET /api/v1/transaction` route and explicitly defines
`edges[].amount` in kobo. Core rows include transaction ID, credit/debit type,
status, category, description, wallet identity/type and timestamp, with optional
merchant/P2P/batch references. Documented statuses are `pending`, `successful`,
`failed`, and `partial`; partial denotes incomplete batch/split payments and
must not be silently relabelled successful.

`retrievePiggyvestStagingTransactionList` requires a trusted mapped
integration/merchant/customer/goal/wallet identity and isolated staging
configuration. It verifies the provider wallet/business before retrieving one
list page through the existing byte/time-bounded transport. The only allowed
list query contains `wallet_id`, `limit` (1–100, default 20), `collapse_batch=0`,
and an optional bounded opaque cursor. No whole-business list or automatic
pagination is enabled. Returned cursors are surfaced to the caller.

Rows require finite safe-integer kobo amounts and exact wallet matches. Other
monetary fields are not projected; collapsed-row counters and batch summaries
are rejected. The result is `{ monetaryUnits: 'kobo', spendable: false,
financialEffects: 'UNKNOWN', edges, pageInfo }`. It does not sum transactions
into customer funds, infer an interest entitlement, post a ledger effect or
assert settlement finality. A list amount's confirmed units do not remove the
remaining event-linkage, webhook delivery, fee, interest or cancellation gates.
Tests use synthetic mappings and injected synthetic fetch only.
