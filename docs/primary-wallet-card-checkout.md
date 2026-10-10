# Primary wallet durable card checkout boundary

Implemented source only. No provider request, deployment, production configuration, real transaction, existing migration change, provisioning edit or mobile edit was performed. The three new migrations start at `20261007200000`; replay registries are intentionally unchanged.

## Routes and lifecycle

Both endpoints are authenticated POST requests with CSRF validation before body processing/customer queries:

- `/api/storefront/customer/wallet/primary-card/initialize`: `{ merchantId, idempotencyKey, amountKobo, consent: { version: "primary-wallet-card-v1", oneTimeCharge: true, saveCard: false | true } }`.
- `/api/storefront/customer/wallet/primary-card/status`: `{ merchantId, operationId }`.

The caller cannot select user, customer, integration, provider identity or treasury. Merchant input must match trusted deployment settings. Customer ownership and confirmed email come from the authenticated RLS client; the database separately checks merchant/customer/user/integration/environment/business/email and dedicated executor login. A verified primary onboarding mapping is required for reservation. There is no goal ID.

Initialize reserves an immutable operation, amount, consent, fingerprint and mapped destination; claims initialization once; performs card-only hosted Paystack initialization through the existing bounded, redirect-rejecting, deadline-aware transport; records the validated session or durable `init_unknown` result; and reads stored status. Retries return the existing operation. A claimed initialization can never be reclaimed or reissued, including after ambiguous transport/process failure. A crash after reservation but before claim can safely retry the claim.

Status verifies the same Paystack reference and exact metadata, amount, NGN currency, domain, customer email and card channel. Success records collection evidence atomically and returns **`custody_pending`**, never wallet credit or completion. One-time payment truth does not require an authorization object or a reusable card. Only explicit `saveCard` consent plus a verified reusable card authorization permits storing the private token. Invalid/unavailable tokenization does not invalidate a successful one-time collection.

Public responses contain operation ID, reference, amount, currency, status and a validated hosted URL only while ready. Tokens, provider response bodies, scope identities and database settings never enter the response. All responses use `no-store`. `initializing`, `init_unknown` and `custody_pending` return 202; ready/read states return 200. Invalid inputs return 400, authentication 401, CSRF/ownership 403, unconfirmed email 409 and unavailable configuration/storage 503.

## Durable capabilities

`piggyvest_primary_card` contains private RLS-enabled settings, operations and collections tables. Direct table privileges and function access for public/anon/authenticated/service-role callers are revoked. Login roles are not created or provisioned by these migrations.

- `primary_card_authorizer` may execute `reserve`, `claim_initialization`, `record_initialization` and `read_operation`. It cannot record collection evidence.
- `primary_card_evidence` may execute `record_collection` and `flag_reconciliation`. It cannot initialize or reserve a checkout and cannot read private tokens directly.

The concrete executor selects only fixed SQL statements, uses separate authorizer/evidence logins, validates database/login/role identity and TLS, rejects elevated or additional transitive role memberships, and bounds query/connection times. It never constructs a Supabase service-role client.

Settings bind each integration to separate executor logins, environment/business/merchant, enabled state, HTTPS callback and current expiry. Database calls require exact agreement with deployment callback/expiry and reject disabled or expired configuration. They also require the existing primary integration to be enabled. Settings default disabled.

Reservation uses an idempotency key and a SHA-256 fingerprint including ownership, request and primary destination. Changed amount/consent/identity under the same key conflicts. One unresolved operation per customer/integration prevents a second collection even when reconciliation is required. Claims use a unique token and row lock; stale/late init results cannot overwrite collection truth. Collection transaction IDs are unique per environment/integration, and replay must match immutable financial identity. Collection evidence and `custody_pending` update in one transaction. No table/function in this boundary credits a wallet or claims PiggyVest custody.

## Trusted deployment configuration

`readPrimaryWalletCardCheckoutRuntime` reads only `PIGGYVEST_PRIMARY_CARD_*` variables: `ENABLED`, `TRANSFER_SCHEDULED`, `CUSTODY_SCHEDULED`, `ENVIRONMENT`, `INTEGRATION_ID`, `MERCHANT_ID`, `BUSINESS_ID`, `EXPIRES_AT`, `CALLBACK_URL`, `PAYSTACK_SECRET`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_CA`, `AUTHORIZER_PASSWORD`, `EVIDENCE_PASSWORD`. Fixed logins are `baci_primary_card_authorizer` and `baci_primary_card_evidence`. New reservations require both schedule attestations (each set only after that worker's systemd timer is installed and enabled); the drain reader bypasses them so operations created while scheduled still resolve.

Expiry is a validated ISO timestamp from trusted deployment configuration and matching database settings. There is no historical deadline allowlist and no automatic renewal. Production requires production deployment context and a live Paystack credential; staging requires a test credential. The callback must be HTTPS with no credentials/query/fragment. Configuration secrets are never returned or logged. No configuration was changed in this task.

Keep this boundary disabled until approved treasury reservation/outbox, signed custody verification, operational reconciliation and the parent webhook hook are ready. Enabling checkout alone would collect funds that correctly remain pending for custody.

## Legacy webhook isolation and minimal parent hook

The new reference family is `pvb-first-primary-<operation UUID>`; metadata is `primary_wallet_card_checkout`. Existing `prefundedCardWebhookBoundary` already returns retryable 503 for the `pvb-first-` family before generic legacy handling. Standalone tests prove a generated primary charge cannot pass that current reference guard to legacy wallet credit. Existing `WAL-` payments and legacy balances retain their backing and recovery paths.

`primaryWalletCardCheckoutWebhookBoundary` additionally recognizes primary metadata, including JSON-encoded metadata when a reference is missing or malformed. The shared payment webhook now invokes the extracted `walletCardWebhookBoundary` after signature and success-event validation, before legacy reference lookup, service-client construction or wallet credit. It checks primary collection routing before the retained legacy prefunded boundary:

```ts
const primaryCardBoundary = walletCardWebhookBoundary(body);
if (primaryCardBoundary) return primaryCardBoundary;
```

The signed metadata-only regression returned HTTP 200 before this connection; object and JSON-encoded metadata now return retryable HTTP 503 without constructing the legacy service client. The route and boundary test run passed 121 tests. This is isolation, not completed reconciliation: replace the retryable response only after durable signed inbox intake queues verification of the stored operation. A webhook success or browser callback is never collection or custody authority by itself.

## Remaining treasury and signed custody integration

The new routes connect real authorizer/evidence storage to concrete Paystack HTTP adapters, but final PiggyVest funding is deliberately absent. Parent work must add approved treasury-capacity reservation before enabling card collection; durable transfer outbox/claims; deterministic transfer references; restricted worker dispatch using the existing documented PiggyVest wallet transfer; authenticated/signed custody evidence and provider ownership crosswalk; atomic treasury debit/receivable/primary credit plus shared transaction deduplication across webhook/polling; settlement replenishment and chargeback/refund recovery; notification/cache outbox; and an approved terminal transition that releases the single unresolved-operation gate.

Existing goal-bound prefunded checkout/provider configuration is not invoked, impersonated or renewed. Existing `primary-wallet-card-funding*` proof helpers still use their earlier collection contract; a future custody worker must adapt them to this durable operation and the one-time collection evidence, without introducing a reusable-token requirement. The private saved token is not yet connected to the general saved-card catalog; do not automatically charge it.

The parent can later wire the retained mobile card entry to these initialize/status endpoints, persist its idempotency key/operation ID, open the returned hosted URL and show `custody_pending` until approved signed custody and ledger completion. Do not wire a `wallet_topup` fallback or relabel preserved Paystack balances as PiggyVest-backed.

## Refund and dispute reversals

Paystack `refund.processed` and `charge.dispute.create` deliveries route to `checkout_reversals`, the money-out counterpart of `collections`. The charge path never reads `transaction_reference`, where Paystack carries the ORIGINAL charge reference, so the checkout-only dispatch tries the reversal reconciler first: it cross-binds the metadata operation ID to that reference, re-reads the stored intent under the runtime scope (ownership on the six immutable IDs, email excluded like status recovery), and records the provider event durably. Against an uncollected checkout the reversal abandons the operation, freeing the one-unresolved slot and releasing treasury; against a collected checkout it records only. Two fences keep the ledger honest: `record_collection` rejects a reversed reference, and `settle_custody_ledger_impl` returns `conflict` instead of crediting. No autonomous debit is attempted — a collected reversal needs an operator to reconcile the provider-side movement against custody — and anything unresolved stays retryable (503) rather than acking money-out evidence as noise. The SQL conformance chain is `primary-wallet-card-checkout-reversal.integration.sql`, which extends the custody settlement-fence chain post-expiry: uncollected abandonment with treasury release, idempotent replay, scope/cross-customer rejection, late-collection refusal, and a dispute that turns settlement into `conflict` with no wallet movement.

## Local validation

Focused node Vitest tests cover authenticated/CSRF/input/ownership routes, current deployment configuration, restricted executor sessions, one-shot initialization, ambiguous-result recovery, collection persistence, non-reusable card success, consented token storage, metadata/reference isolation and hardened provider result validation. The run including the existing transport/legacy boundary tests passed 90 tests across 12 files (76 new tests). Scoped Biome passes across 22 TypeScript files; all new files remain below 300 lines. The isolated local PostgreSQL fixture applies the primary onboarding prerequisite and all three new migrations, then checks reservation idempotency, one-time/stale claims, init-result persistence/read, wrong scope/expired settings, private grants/RLS, transaction replay conflicts, cross-operation transaction reuse and consented/unconsented token evidence. It never connects to a cloud database.

Run focused tests from `apps/web`:

```sh
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm exec vitest run --environment node src/lib/piggyvest/primary-wallet-card-checkout*.test.ts src/schemas/primary-wallet-card-checkout*.test.ts src/app/api/storefront/customer/wallet/primary-card/primary-wallet-card-checkout-route.test.ts src/app/api/storefront/customer/wallet/primary-card/initialize/route.test.ts src/app/api/storefront/customer/wallet/primary-card/status/route.test.ts src/lib/piggyvest/prefunded-card-provider-request.test.ts src/lib/piggyvest/prefunded-card-webhook-boundary.test.ts
```

The PostgreSQL test is `apps/web/src/lib/piggyvest/primary-wallet-card-checkout.integration.sql`. Run it only in a fresh isolated local cluster; it creates synthetic roles/tables and applies its prerequisite migrations. The verified cluster used a private temporary Unix socket with TCP disabled and was stopped afterward.

Broad typechecks/tests, replay registry updates, deployment-capability provisioning, signed webhook hookup, treasury/custody work and production activation remain parent gates. No live financial behavior has been validated.
