# Address budget PostgreSQL cutover

This replaces address-counter storage, not provider pricing or the coordinate
requirements for GIG delivery. It does not authorize paid usage. The ledger starts
empty and denies upstream requests until an owner records verified allowance.
No historical Redis count, screenshot or assumed daily reset establishes current
account-wide remaining allowance.

## Evidence required before activation

Record an evidence reference, observation time, account/project identifiers and the
exact credential fingerprints used by production and previews. Never put API keys,
JWTs, customer addresses or billing exports in repository files or logs.

- Google: verify billing-account aggregate Legacy Details, autocomplete per-session
  and autocomplete per-request usage for the current Pacific calendar month. Include
  other projects/apps sharing the account, retries, abandonment and the separate
  reviews integration. Confirm applicable free allowances and any existing charges.
- Geoapify: verify the actual plan, credit reset timezone, account-wide consumed and
  remaining credits, and all applications/API keys using the account. Its Free plan
  is 3,000 credits/day with soft limits, not a guaranteed zero-cost hard stop.
- Fence every old deployment/preview using Redis before enabling the new ledger,
  or establish a conservative finite bound for every remaining old/in-flight and
  external consumer. Include that liability in the imported baseline. An account
  usage snapshot alone is insufficient while unbounded consumers can continue.
  Keep old Redis settings intact until those instances are fenced: deleting a
  preferred pair could make old code choose a different counter store.
- Confirm the existing Supabase scoped signing material and available database
  capacity. This change does not provision new credentials or upgrade any plan.

If any item is unknown, leave authorization absent. Preserve manual entry and
Store Pickup; do not issue a speculative provider request to test the account.

## Normal reviewed release

1. Run the SQL concurrency/replay tests, real signed PostgREST confinement tests,
   provider regressions, database history replay, lint, typechecks and required reviews.
2. Deploy through the normal coordinator. Migration `20261030075538` adds only the
   restricted request guard and anonymous canary. The release observes canary reload
   before migration `20261030075540` grants the dedicated reservation role. The guard
   changes the existing GIGL hook, so normal worker/schema integrity checks apply.
3. Verify the served revision and manual-address Store Pickup with provider calls
   mocked or blocked. Record that this is not live suggestions verification.
4. After current account evidence and consumer fencing are verified, use the existing
   authorized owner connection to call the private initialization function. It is
   deliberately inaccessible to web clients, anon, authenticated, service_role and
   the reservation role. No public route or new administrative credential is needed.

The owner operation is:

```sql
SELECT address_budget.authorize_provider(
  selected_provider => 'google', -- or geoapify
  selected_account => '<verified account reference>',
  accepted_hashes => ARRAY['<sha256 of exact trimmed dispatched key>'],
  baseline => <verified conservative consumed units plus remaining liability>,
  evidence => '<restricted evidence reference>',
  legacy_dispatch_ended_at => '<verified last possible legacy dispatch>',
  expires_at => '<verified authorization expiry>'
);
```

The example is intentionally not executable with guessed values. Google expiry
cannot exceed the current Pacific month; Geoapify expiry cannot exceed 24 hours.
The same provider lock serializes owner updates and request reservations. Accepted
key rotation cannot create a new balance. A Google baseline and unexpired Geoapify
debt cannot decrease. Only expired Geoapify debt may be replaced after fresh
verification; existing recent reservations are still added conservatively.
Do not double-count the new ledger unintentionally when deriving a renewal
baseline: document which external/legacy liabilities it represents.

5. Only when the recorded remaining allowance demonstrably covers the check may a
   minimal live suggestion/selection smoke run. Verify address fields, valid pin and
   the supported quote path without creating an order or submitting payment. GIG
   operational calls remain separately subject to their cost authorization.

## Reservation behavior and rollback

Each upstream attempt gets a unique UUID. Replays return denial, including across
keys/providers. A committed reservation remains consumed even if its response is
lost or the provider fails. Google retries each obtain a new reservation. Geoapify
waits once only for a pacing refusal, which has consumed no unit. Every dispatch
checks the database-issued deadline immediately before fetch.

To stop new admissions, the authorized owner can take the same provider advisory
transaction lock and update only `valid_until` to the current database time, or
revoke the reservation role through the approved operational path. The initialization
function intentionally refuses expired grants, so it is not a revocation method.
Preserve tables and all consumed usage. A code rollback must not reactivate an
old Redis ledger with an independent balance; keep old instances fenced until their
liability is reconciled. Never truncate, reset or refill counters to recover availability.

Ledger rows contain attempt metadata and key hashes, not address/customer content.
Keep current-period and rolling-window history intact. Before enabling sustained
traffic, agree bounded owner maintenance and evidence retention; runtime clients
have no DELETE/UPDATE permission. No cleanup job or paid capacity is activated by
this patch.

## Pricing basis

[Google Legacy pricing](https://developers.google.com/maps/billing-and-pricing/pricing#legacy-product-pricing)
lists completed-session autocomplete at $0 with unlimited usage, while Legacy
Place Details has 5,000 monthly free events then $17/1,000 in the first paid tier.
Basic address fields avoid supplemental data fees, not the base Details charge.
Abandoned sessions and untokened requests have separate billing. The conservative
4,400/4,500 attempt limits are not SKU-aware accounting and do not cover every
Google product on a shared account.

[Geoapify pricing](https://www.geoapify.com/pricing/) and its
[terms](https://www.geoapify.com/terms-and-conditions/) require aggregate usage
verification and attribution. Neither provider's free allowance means unlimited
zero-cost end-to-end address lookup.
