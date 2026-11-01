# S-05 plan: consumer Phase A — initiation route + availability lookup (v2)

Dated 6 October 2026. Status: v2 amended per pre-coding REJECT (F1–F18),
research corrections, and recheck delta (D1–D5); pending final checklist
confirm. Parent: corrected
`S04-DESIGN.md` (Phase A only), `S03-DESIGN.md`, `CONTRACT-REGISTER.md`
(CR-01/02/07 partial, CR-14/CR-12/product open). No live provider calls.

Route creation here is explicitly authorized by handoff §5 despite D-04's
no-routes clause (F14): these routes create no attempt/hold/state and make
no provider contact.

## Goal

The smallest confirmed consumer slice: two routes sharing S-03 with exact
customer/order authorization, deny/503-only behavior, zero DB writes, zero
provider calls.

## Disjoint file set (implementer owns; ALL new, nothing else touched)

- `apps/web/src/schemas/oxygen-requests.ts` + `.test.ts` — Zod v4:
  `oxygenAttemptRequestSchema = z.object({ orderId: z.uuid() })` (POST body,
  strip unknown keys per Zod default); `oxygenAvailabilityQuerySchema =
  z.object({ orderId: z.uuid() })` (GET query). `z.infer` type exports.
- `apps/web/src/lib/payments/oxygen/context.ts` + `.test.ts` — resolve does
  ALL I/O; prove is pure comparison (D2). `resolveOxygenOrderContext(supabase,
  orderId, sessionUserId)` returns `{ ok, order, customerRow, staffCtx,
  s03input } | { denied }`: order via `select('id, merchant_id, customer_id')`
  (exact list — orders has NO `status` column; F11) `.eq('id',
  orderId).maybeSingle()` (DB errors propagate; route maps to 500 — F17;
  zero rows → denied); customers row via `customers.select('id')
  .eq('merchant_id', order.merchant_id).eq('user_id', sessionUserId)
  .maybeSingle()` (same scoping as the storefront/orders precedent, but
  maybeSingle + error propagation so outages → 500 via the route, never
  masked as 404; zero rows → denied on customer path);
  staff ctx via `getMerchantForApiRequest(supabase, userId, {
  requestedMerchantId: order.merchant_id })` (F6: avoids false 404s for
  multi-merchant staff; membership still server-verified).
  `proveOxygenOrderAccess({ order, customerRow, staffCtx })` (pure, no I/O):
  customer path requires `customerRow?.id === order.customer_id` (F1: never
  compare a session id to `customer_id` directly; disjoint id spaces); staff
  path requires non-null ctx + real `hasPermission(toUserAccess(ctx),
  'orders', 'edit')` (generate-dva precedent, NOT ship-on-credit — F3; mock
  only context data, never the rule). Customer path attempted first, staff
  path second; any failure → denied. Builds the S-03 input on success:
  `merchant.id` = order row (customer path; binding enforced by the scoped
  customers lookup, tautology acknowledged — F6), ctx merchant on staff path;
  `customer` = proven `order.customer_id` (nullable) on BOTH paths (F2/F18 —
  staff on a guest order yields S-03 guest-deny, never allow);
  `environment` === `expectedEnvironment` = single private
  `resolveDeploymentEnvironment()` return in context.ts
  (`process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development'`,
  reading only — same VERCEL-first/NODE-fallback logic as
  quiz-compliance-gate's deployment helpers (D3); route-level mismatch
  unreachable by construction, branch covered by S-03 unit tests; pinned via
  an s03input-equality test, not a direct export); `rollout
  {newInitiationsEnabled:false}` (server default; env var needs owner
  approval — not in slice), `policy {guestInitiationsAllowed:false}`
  (product decision open), `providerReadiness {verified:false}` (CR-14 open)
  — each literal cited (F5). context.ts builds the S-03 input WITHOUT
  importing `availability.ts` (D5); only the two routes import it.
- `apps/web/src/lib/payments/oxygen/initiation.ts` + `.test.ts` — two pure
  mappers, no authz params (F8): `mapInitiationDecision(decision)` →
  deny→403 per S-04 table, allow→constant `503
  { error: 'Oxygen provider unavailable', code:
  'oxygen_provider_unavailable' }` (no execution stage exists; D-04 forbids a
  flag implying one — Phase B replaces this arm with the atomic attempt
  operation); `mapAvailabilityDecision(decision)` → always-200
  `{ available, reason? }` (reason only when false). No I/O, no imports.
- `apps/web/src/app/api/payments/oxygen/attempts/route.ts` + `route.test.ts` —
  POST pipeline (pinned order): 1) rate limit FIRST
  (`ensureActionRateLimit('oxygen-initiation', { requests: 10, windowMs:
  60_000 })`, repair-status values; false → 429 `{ error: 'Too many Oxygen
  requests. Please try again shortly.' }`); 2) `checkCsrfProtection` (cookie
  POSTs; Bearer [REDACTED] auto-skipped by the helper; failure shape owned by the
  helper — F7); 3) JSON parse + Zod (`{ error: 'Invalid JSON body' }` /
  `{ error: 'Invalid request', details: fieldErrors }`, credit-direct
  precedent; validation-before-auth diverges from storefront/orders'
  authenticate-first order — deliberate: public schema, no oracle, saves
  work); 4) `authenticateApiRequest` (Bearer [REDACTED] cookie; ANY failure →
  byte-identical 401 `{ error: 'Unauthorized' }` (D4: generate-dva/customers/
  storefront-orders precedent string, not an invented message) — F4);
  5) load + proof →
  uniform 404 `{ error: 'Order not found' }` for missing/foreign/unproven/
  null-customer-on-customer-path/staff-denied (F4/F9: staff-denied is 404
  for uniformity; D1: PROVEN staff on a guest order proceeds to S-03 and
  denies 403 `oxygen_guest_not_allowed` instead); DB
  error → 500 `{ error: 'Unable to load order' }` (F17); 6) S-03 → mappers.
- `apps/web/src/app/api/payments/oxygen/availability/route.ts` + `route.test.ts` —
  GET: same pipeline with `oxygen-availability` bucket (F13: both routes
  limited, distinct buckets); CSRF helper called though it auto-passes safe
  methods (deliberate uniformity — no GET precedent does this, harmless here);
  query validated via `request.nextUrl.searchParams`
  (storefront-features precedent); 200 decision; no order details echoed.

Precedents the implementer MUST read first: credit-direct sign `route.ts` +
`route.test.ts` (structure + supabase/cookie mocking), `api-auth.ts`
(`authenticateApiRequest`, `hasPermission` re-export), `csrf.ts`
(`checkCsrfProtection` + customers POST caller), `get-merchant-for-api-request.ts`,
`ensure-action-rate-limit.ts` + repair-status caller + its test, generate-dva
`('orders','edit')` usage, orders Row columns, S-03 taxonomy. Limiter is
per-instance memory: fine for Phase A, not a strong oracle backstop (F13).

## Non-negotiable rules

- Exact authorization per above; merchant match alone authorizes nothing.
  Customer A can never touch B's order (guessed UUIDs, switched sessions,
  cross-merchant posts included).
- Guest capability NOT built: unauthenticated → 401 pre-load; authenticated
  but unproven (incl. null-`customer_id` orders on the customer path) → 404;
  proven staff on a guest order → S-03 403 guest-deny (D1). Customer-path
  guest-403 is covered at unit level only in Phase A (F4). No 404-vs-403
  oracle: 404 means "no accessible order for you", 403-guest means "you are
  authorized staff on a guest order".
- No DB writes: no insert/upsert/update/delete/rpc on any path. Mock clients
  MUST expose those methods as throwing spies asserted zero-called across
  deny/404/429/503 paths, incl. duplicate/concurrent posts; assert no
  `auth.admin` usage (F10). Reads, `auth.getUser`, the limiter's process-local
  Map, and console-only logging are the only effects. Races safe by
  construction (reads only); verdicts are point-in-time reads, so GET→POST
  may disagree after an order edit — bounded to a wrong verdict, never state
  corruption; the concurrency test asserts identical verdicts + zero writes
  under parallel load, not serialization (F16).
- No provider contact: transport/token-cache MUST NOT be imported by any S-05
  file (static test); the 503 arm performs no I/O.
- Consistency: both routes share context code + S-03; shared-decision test
  pins identical verdicts (403 reason X ⟺ `available:false` reason X;
  allow ⟺ 503 / `available:true`) at both entry points.
- Exact response shapes (F12; key-exactness tests, no extra keys; no-id sweep
  over all error bodies): 400 invalid-JSON `{ error: 'Invalid JSON body' }`;
  400 invalid `{ error: 'Invalid request', details }`; 401 `{ error:
  'Unauthorized' }` (precedent string — D4); 404 `{ error: 'Order not
  found' }`; 403 per S-04 message
  table as `{ error, code }` where code = reason string; 429 as above; 500
  `{ error: 'Unable to load order' }`; 503 `{ error: 'Oxygen provider
  unavailable', code: 'oxygen_provider_unavailable' }` (no Retry-After).
  CSRF failure shape owned by `checkCsrfProtection`. Unknown keys stripped.
- Default-off preserved: readiness hardcoded unverified; projection field,
  UI wiring, attempt persistence NOT in this slice.

## Wiring gate (redefined per F15, pinned per D5)

S-05 intentionally wires `availability` into two routes, so the old "no
matches" gate is replaced: assert via search that NO file outside the two
S-05 routes (+ their tests) imports an oxygen module; that ONLY the two
routes import `availability.ts` (context builds the input without importing
it); and that NO S-05 file imports transport/token-cache. Run in evidence.

## Blocked by design (unchanged: CR-14→persistence/readiness, CR-12→idempotency,
CR-01-test/02/06/08/12→invocation, product→guest/projection)

Attempt creation + transactional revalidation RPC: needs CR-14 (connection
FK/account model) + CR-12 (idempotency). Concrete design (handoff §2.1
shapes, S-04 §C.7 properties) is complete; code waits. No speculative
migration. Readiness dynamics, provider invocation, guest capability, and the
merchant projection field stay out for the same stated reasons.

## Acceptance criteria

- Behavioural RED per file (tests first, compiling stub failing assertions;
  setup failures don't count), minimal GREEN, refactor, re-run.
- Implementable-now enforcement tests: full denial matrix with exact
  codes/messages; 404 uniformity (missing/foreign/guessed-UUID/cross-customer/
  cross-merchant/staff-denied, byte-identical); 401 uniformity pre-load;
  guest matrix (unit-level guest mapping + route-level 404 for
  null-customer orders on the customer path + route-level 403 guest-deny
  for proven staff on a guest order — D1); no-write throwing-spy incl.
  concurrency; merchant
  A/B isolation; allow→503 (mapper-unit; route-level unreachable) and
  env-mismatch (S-03-unit; route pair equal by construction) scoped to unit
  level (F5); shared-decision consistency; static no-provider-import test;
  redefined wiring gate; rate-limit 429 on both routes + bucket independence;
  CSRF cookie-without-token→403 / Bearer-pass on POST.
- Route tests mock ONLY integration seams (supabase client incl. throwing
  write spies, merchant helper context data, rate limiter, auth helper
  results) per repo precedent; `prove` (comparison), S-03, and both mappers
  are pure and tested mock-free, while `resolve` is tested with mocked
  supabase asserting exact query shapes (select strings, eq args) plus
  null/error mapping (D2).
- `biome check` clean on owned files; owned vitest green; `turbo lint
  typecheck --filter=@baci/web`; CodeRabbit gate; exact commands/counts/
  failure summaries reported; docs untouched by implementer.
