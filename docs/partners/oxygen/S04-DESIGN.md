# S-04 design: initiation route + payment-method listing (design-only)

Dated 6 October 2026. Status: design-only. No code is written in this slice:
implementation is gated on CR-14 at minimum (readiness/connection model), with
provider invocation further gated on CR-01/02/06/08/12 and guest UX on the open
product decision. Parent docs: `S03-DESIGN.md` (the policy), `CONTRACT-REGISTER.md`,
`INDEPENDENT-S02-REVIEW.md` § Next slice. This answers the review's point 4
(consumers defined before any enforcement is claimed) without building
scaffolding the provider answers may reshape.

## Architecture: one policy, three call sites

`decideOxygenNewInitiation` (S-03) is the single decision function. Both
consumers below call it (or its separate merchant-level pre-filter) with
server-resolved inputs; no consumer reimplements, weakens, or caches its
verdict as authorization. The six reason codes are id-free and secret-free by
construction, hence safe for server logs and (where noted) client responses.

### A. Storefront features projection (display pre-filter only)

Extend the existing public projection (`app/api/storefront/features/route.ts`,
via the established `cached-data` path) with one field:

- `oxygenMerchantReady: boolean` — server-computed from rollout + readiness
  only (merchant-level, customer/order-agnostic, cacheable per merchant like
  the existing flags). False until a verified connection exists.

The client hides Oxygen unless true. This is a display pre-filter, never
authorization: it cannot see the caller or order, so it must never allow —
only hide. Silent hide while false (never advertise an unusable method).

### B. Availability lookup (authoritative display decision)

Future `GET /api/payments/oxygen/availability?orderId=<uuid>`:

- Authenticates the caller (customer session or order-bound guest capability
  per the future guest decision), proves customer ownership or the approved order-bound guest capability before
  loading the order scoped to its merchant, resolves the full S-03 input server-side,
  and returns
  `{ available: boolean, reason?: OxygenAvailabilityReason }`.
- The method list calls this when an order context exists and refines display:
  hide on deny; on `oxygen_guest_not_allowed` it may prompt login (the only
  reason with display behavior — see message table). Reasons stay
  machine-readable; no human-readable provider text is ever rendered.
- Re-resolves and re-decides per call (no client-cached verdict is trusted);
  merchant-level caching applies to projection A only. This GET uses an authorized
  read, not a claimed long-lived order lock; initiation revalidates atomically.
- S-03 does not check customer ownership: its input has no order customer ID.
  Authenticating a customer and matching a merchant is insufficient. The consumer
  must prove that this customer may access this exact order before returning results.

### C. Initiation route (the only enforcement point)

Future `POST /api/payments/oxygen/attempts` (naming follows the plan's
candidate namespace; exact path at implementation):

1. Authenticate + resolve merchant via `getMerchantForApiRequest` semantics
   for staff/owner paths, or trusted host/slug-alias resolution plus
   order-bound customer capability for storefront paths (Credit Direct sign
   route is the structural precedent; its provider/RPC contract is NOT reused).
2. Validate the request with a Zod schema in `schemas/` (`orderId` uuid,
   tracking/customer proof); malformed JSON → 400.
3. Prove exact customer/order ownership (or the approved guest capability), or
   staff permission for this operation, and load explicit merchant-scoped columns.
   Missing/foreign orders receive the SAME status and safe response shape (for
   example 404); do not choose 404 for missing and 403 for foreign. S-03 supplies
   binding checks, not this authorization proof.
4. Resolve the S-03 input (see § Trusted context) and decide. On deny →
   403 `{ error, reason }` per the message table, with MUST-NOT-INVOKE
   guarantee: no attempt row, no provider call (future enforcement test pins
   this with an injected-transport spy).
5. Rate-limit initiation attempts with the existing `ensure-action-rate-limit`
   / `rate-limit-routes` mechanism (no bespoke limiter).
6. Phase A: if no confirmed executable provider stage exists, return
   `503 oxygen_provider_unavailable` BEFORE creating an attempt. Local permission
   alone does not justify a durable financing hold or claim of a started application.
7. Phase B: once the applicable contracts close, one atomic DB operation acquires
   the order lock and revalidates caller authority, merchant, order version, amount,
   unresolved financing and idempotency before creating/reusing an attempt/action
   intent. A route-level SELECT cannot hold a lock across a subsequent Supabase
   request. Network calls occur after commit; response-loss recovery follows CR-12.
   Schema/RPC design waits for CR-14 and safe mutation design waits for CR-12.

## Trusted context resolution (future `resolveOxygenContext`)

| S-03 input | Trusted source | Gated by |
| --- | --- | --- |
| `merchant.id` | `getMerchantForApiRequest` (privileged) or trusted host/slug resolution (storefront); never a body-selected tenant | Exists |
| `customer` | Authenticated customer session, else null guest | Exists; guest use needs product decision |
| `order` | Authorized merchant/customer-scoped read for lookup; transactional revalidation/lock for initiation | Read patterns exist; Oxygen atomic operation unbuilt |
| `environment`/`expectedEnvironment` | Deployment server config, never client input | Exists |
| `policy.guestInitiationsAllowed` | Server default `false` until the product decision lands | Product decision |
| `rollout.newInitiationsEnabled` | Deployment-owned server config (kill switch). NOT merchant-editable, NOT `custom_settings` JSON. The actual variable needs owner approval (env-file rule) | Design now; var later |
| `providerReadiness.verified` | Future connection lookup keyed (merchant, provider, environment), RLS-safe, secrets never in output. Today: hardcoded `{ verified: false }` | CR-14 (schema + provisioning/beneficiary model) |

## 403 message table (safe; no internals)

| Reason | HTTP | User-facing message |
| --- | --- | --- |
| `oxygen_identity_mismatch` | 403 | "This order cannot use Oxygen." |
| `oxygen_environment_mismatch` | 403 | "Oxygen is not available here." |
| `oxygen_guest_not_allowed` | 403 | "Sign in to continue with Oxygen." |
| `oxygen_not_configured` | 403 | "Oxygen is not available for this store." |
| `oxygen_rollout_disabled` | 403 | "Oxygen is not available right now." |
| `oxygen_provider_unverified` | 403 | "Oxygen is not available for this store." |

Server logs carry the reason code; responses carry the message + code (both
safe) only AFTER order authorization. Missing and foreign orders receive the same
status/shape; id-free policy reasons do not by themselves authorize disclosure.

## Listing behavior per surface

- **Web checkout** (`payment-step-availability.ts`): add the oxygen case fed
  by projection A + lookup B. Must never render as credit approval (S-01
  D-05); method availability ≠ eligibility, in code comments and copy.
- **Mobile storefront**: `BNPLParamsSchema` gateway enum, `bnpl-url.ts`
  navigation, and `usePaymentMethodAvailability` extend only after server
  authority exists; app constants never become server authority. Popup-origin
  allowlist additions require confirmed Oxygen origins (CR-04/CSP note).
- **Chat**: same boolean via the backend orchestrator + secure form handoff
  for sensitive steps (plan § Chat-led option); no model-side policy.

## Enforcement tests (specified, unbuilt — Phase A)

- Route denial matrix: every S-03 reason → 403 with exact code/message; auth
  failures → 401; missing/foreign orders → the same 404 shape; malformed JSON → 400.
- Zero-invocation: injected transport spy + attempt-table spy assert nothing
  is created/called on any deny path, including duplicate/concurrent posts.
- Guest matrix: null customer denied pre-decision; allowed only when the
  injected product flag flips (flag test, not a product claim).
- Listing: projection false → hidden; lookup deny → hidden/refined; guest
  reason → login prompt; no credit-approval language in snapshots/copy.
- Customer authorization: authenticated customer A cannot query/start customer B's
  order even when both belong to one merchant. Include guessed UUIDs, switched
  sessions, revoked guest capabilities and owner/staff permission denial.
- Transaction/race: invoice edits, payment-method switches and concurrent attempts
  are revalidated under one order lock, not stale route reads.
- Phase A unavailable: no provider call AND no attempt/financing hold, even when
  local policy allows.
- Isolation: merchant A's readiness never leaks to B (projection scoping +
  per-call authz); environment mismatch pinned across deployment configs.

## Answer → build map (why answers are the priority)

| Provider answer | Unlocks |
| --- | --- |
| CR-14 account/provisioning/beneficiary model | Connection schema, readiness resolver, route Phase A build |
| CR-01/02 environment mapping + test credentials | Transport wiring tests against sandbox login |
| CR-06 units/principal/tenure + CR-10 offer terms | Booking/offer implementation (Phase B) |
| CR-08/12 webhooks/status/idempotency | Inbound events + reconciliation (Phase C) |
| CR-04/09 KYC/statement + product decisions | Full journey UX, guest policy, listing copy |
| CR-11 settlement/refunds + CR-07/13/15 | Accounting, returns, territory gating, rate limits |

No further isolated helper is planned: the next code written after answers
arrive is the CR-14 readiness resolver + route Phase A above.

## Out of scope

All code, migrations, settings columns/flags, env vars, provider calls,
sandbox runs, product decisions, and partner contact. This slice is
reviewable prose:
consistency/link checks + the doc gate only.


## Independent design correction

6 October 2026: clarified customer/order authorization, uniform missing/foreign
responses, authorized GET reads versus transactional initiation locks, and no attempt
creation when provider execution is unavailable. S-03 remains unchanged: its policy
cannot establish ownership. Enforcement tests above remain specified and unbuilt.
