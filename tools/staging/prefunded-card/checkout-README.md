# Durable first-card checkout storage

Status: locally rehearsed staging storage, not deployed. The disposable PostgreSQL harness passed all five tests on 2026-09-27, including an independent parent rerun. These scripts are not a migration, do not activate the public `newCardEnabled` capability, and do not call Paystack, Supabase, or any live database.

## Apply order

Apply only after the existing prefunded-card storage, treasury identity/readiness, authorization storage/functions, projection admission, dispatch queue, and `executor-roles.sql` are already present:

1. `checkout-storage.sql`
2. `checkout-reserve.sql`
3. `checkout-initialization.sql`
4. `checkout-promotion.sql`
5. `checkout-roles.sql`
6. `checkout-regressions.test.sql` only in a disposable staging fixture

The PostgreSQL roles already exist and are deliberately unchanged. The scripts grant only these seven entry points:

| Executor | Functions |
| --- | --- |
| `prefunded_treasury_operator` | `checkout_reserve`, `checkout_read` |
| `prefunded_authorizer` | `checkout_claim_initialization`, `checkout_complete_initialization`, `checkout_mark_initialization_uncertain`, `checkout_promote_collection`, `checkout_flag_reconciliation` |

The executor check is exact: a caller must have that `session_user`, be non-superuser and non-BYPASSRLS, and use the same physical database recorded on the intent. The legacy treasury `authorized_login` remains immutable; it is frozen on the intent and checked against its binding, but the authorizer does not impersonate it. There are no table grants and no grants to `PUBLIC`, `anon`, `authenticated`, or `service_role`.

The TypeScript staging configuration pins the approved isolated staging system identifier. SQL does not duplicate that environment-specific literal: it requires a decimal `scope.systemIdentifier` to equal the genuine local `pg_control_system()` value, records that value with the current database name, and independently checks the provisioned treasury binding, treasury identity, and integration identities. The disposable harness supplies its own genuine scratch identifier and includes a wrong-identifier refusal case; it never alters `pg_control_system()` or connects to staging/production.

## Adapter catalog

```sql
prefunded_card.checkout_reserve(jsonb scope, jsonb request) returns jsonb
prefunded_card.checkout_read(jsonb scope, jsonb selection) returns jsonb
prefunded_card.checkout_claim_initialization(jsonb scope, jsonb selection) returns jsonb
prefunded_card.checkout_complete_initialization(jsonb scope, jsonb selection, jsonb claim, jsonb session) returns jsonb
prefunded_card.checkout_mark_initialization_uncertain(jsonb scope, jsonb selection, jsonb claim) returns jsonb
prefunded_card.checkout_promote_collection(jsonb scope, jsonb selection, jsonb collection) returns jsonb
prefunded_card.checkout_flag_reconciliation(jsonb scope, jsonb selection) returns jsonb
```

`reserve`, `read`, `complete`, and `promote` return the exact snapshot shape required by `prefunded-card-checkout-state.ts`, including conservative `reconciliation_required`. `claim` returns either `{ outcome: 'claimed', intent, token, fence, leaseExpiresAt }` or `{ outcome: 'existing', snapshot }`; `leaseExpiresAt` is canonical UTC ISO text with a `Z` suffix. The two acknowledgement functions return JSON `true`.

## Durable safety boundary

`checkout_reserve` validates the staging scope and deadline before taking locks and once more after binding/identity/customer/goal waits, immediately before its atomic writes. Initialization completion, promotion, and reconciliation flagging likewise recheck the deadline after locks and immediately before mutation. It locks the enabled treasury binding before treasury identity, customer, mapping, and goal checks; reuses the existing treasury `reserved_kobo` and goal-capacity accounting; then inserts one private intent and the existing `prefunded_card.operations` row atomically. The operation ID is the intent UUID, the collection reference is `pvb-first-<intent UUID>`, the transfer reference is `pvbt-<intent UUID>`, and `collection_status` is inserted as `pending`—never `not_started`.

Every checkout path locks its scoped treasury before locking an existing intent.
Promotion consequently holds treasury before the existing operation, matching the
canonical worker order. This avoids a new-key reserve waiting for an intent whose
initializer is waiting for that same treasury. The scratch lock regression holds
treasury, observes the initializer waiting, and uses `NOWAIT` to assert that the
initializer has not already locked the intent; it rolls the claim back afterward.

No public saved method exists at reserve. Reserve denies a customer who has any Paystack saved method, including a disabled method, and the partial unique index permits only one unresolved first-card intent for each integration/merchant/customer scope. Same-idempotency retries return the immutable snapshot; changed payloads conflict before another reservation.

The checkout intent freezes actor, owned-customer email, consent version and booleans, request fingerprint, scope, database, and treasury login. It has RLS deny-all and an immutability trigger. The existing operation immutability guard remains in place.

The replacement `claim_collection` first reads status without dispatch authority and returns stale unless it is exactly `not_started`. The first-card transition trigger rejects `pending -> dispatching`; therefore the canonical worker cannot issue a generic saved-card charge for first-card intents. A runtime verification path must use the existing authorization-reader compatibility check before any provider request; the prepared method has no authorization binding until independently verified collection succeeds, so that check defers rather than falls back to HTTP.

Initialization claims only once from `reserved`, with a lease of at most 120 seconds and never later than the fixed deadline. A matching claim token/fence is required to complete initialization. Expired or unknown initialization never creates another session, releases float, or reopens POST. The only post-deadline mutation is `checkout_mark_initialization_uncertain`, which requires the original still-owned `initializing` token/fence and records conservative `pending` without extending the lease or calling a provider.

`checkout_promote_collection` is authorizer-only and deadline-blocked. It accepts only the exact normalized test-domain collection: intent/reference/amount/currency/email, reusable card authorization code/signature/customer code, and card display fields. It atomically inserts the prepared public saved method, inserts the immutable compatible authorization binding with the intent UUID as transaction ID, persists the normalized collection, and marks the original operation `verified_success`. It retains the existing treasury reservation and leaves transfer `not_started`; only the canonical transfer path may continue. It never credits an internal wallet or the savings principal.

Promotion may finish from `initializing` when an independently verified collection arrives before initialization completion. The token is cleared in that same transaction, so a late initialization completion cannot reopen the session. `verified_collection` is write-once. `funding_pending` remains stored until the existing canonical projection succeeds; `checkout_read` derives the returned `completed` phase from `projection_status = 'applied'` without mutating checkout evidence.

If another writer saves the same Paystack authorization signature while checkout is pending, promotion returns `reconciliation_required`, preserves the treasury reserve, and neither deletes nor overwrites the method. It does not create a replacement operation or make another charge. Resolve that conflict manually from provider evidence before any release decision.

Promotion checks expiry again inside its uniqueness-conflict handler and after
the successful insert/update block, so an insert wait cannot commit new checkout
state after the deadline. The SQL regression includes a structural guard for the
exception-path check; it is not an executed wall-clock expiry rehearsal. Checkout
regressions ran successfully after the performance window ended on 2026-09-27.

## Remaining activation gates

- Parent runtime must derive customer/actor IDs from trusted session ownership, use the exact catalog and executor profiles above, initialize once from a live claim, and reject provider activity after deadline.
- Parent verifier must independently obtain and normalize provider verification evidence before invoking promotion; client JSON is never a verifier input.
- A reviewed append-only migration/apply plan, restricted credential path, provider contract, and staging end-to-end evidence remain required before activation. The disposable fixture pass does not replace those gates. Keep `newCardEnabled` false until those gates pass.
