# Read-only transaction reconciliation coordinator handoff

Live browser verification: 12 September 2026,
https://www.piggyvestbusiness.com/docs/api/transactions/single
(web fetch failed; the browser rendered the full official contract).

`reconcilePiggyvestTransaction` accepts explicit staging configuration, an
injected HTTP implementation, and a **trusted server-resolved** binding containing
`transactionId`, `walletId`, `customerId`, `businessId`. The coordinator must load
this binding from its authorized mapping, never copy it from a request or webhook.
IDs currently accept only ASCII letters, digits, underscores and hyphens; other
provider ID formats require an explicit contract review rather than normalization.

The adapter first uses the existing read-only wallet client to verify the wallet
ID and documented `business_id`. It then performs exactly one transaction GET
with a mandatory wallet filter, compares the returned transaction/customer IDs,
and requires the bound wallet to equal source or destination. Neither direction
is interpreted as a financial category. These two sequential requests each have
explicit bounded timeout/bytes; maximum total wait is twice the configured timeout.

## Exact shared transport extension requested

The coordinator may extend `staging-json-request.ts` GET support with only:

`/api/v1/transaction/{encodedTransactionId}?wallet_id={encodedWalletId}`

Require exactly one mandatory wallet query parameter; reject fragments, duplicate
or additional parameters, path suffixes, unsafe identifiers and every non-GET
method. Keep the fixed `https://staging.piggyvest.business` origin, redirect
rejection, stream/chunk/byte/deadline bounds and sanitized errors. No shared
transport file was edited here. `transaction-reconciliation-request.ts` calls
`requestPiggyvestStagingJson` directly with this exact path, GET and the explicitly
injected fetch implementation. There is no separate reader or transport fallback.
The coordinator supplied the exact shared allowlist extension during this work.
Tests exercise the real shared transport with synthetic injected HTTP responses;
no arbitrary JSON reader is injected and no provider operation is performed.

Transaction response projection: `status: true`, then `data.id`, `customer_id`,
`source_wallet`, `destination_wallet`, `status`, numeric `amount`, numeric `fee`,
`category`, `reference`, and numeric `break_down.gross_interest_payout`,
`withholding_tax`, `net_interest_payout`. Arbitrary metadata, narration and all
other fields are dropped. Required projection fields missing or malformed yield
`needs_contract`. No transaction `business_id` or currency field is documented;
the separate wallet lookup supplies business evidence. No inferred transaction
currency, units, category meaning, webhook linkage or interest eligibility exists.

Every result carries `financialEffects: 'UNKNOWN'`. A `verified_observation`
means only that the projected read matched the binding. All statuses, including
successful, partial and unknown future strings, have no ledger effects. Failures
return `needs_contract` or `ownership_gap` with stable reasons and no payload.
There are no database calls, logging, mutations, retries or runtime wiring.
