# S-03 design: Oxygen default-off availability boundary (proposed)

Dated 6 October 2026. Status: implemented 6 Oct 2026 (35/35 tests, gates
pass); self-critiqued before coding; CodeRabbit: 1 minor on token-cache
(rejected with reason in TDD-EVIDENCE.md), nothing on S-03 files.
Parent docs: `INDEPENDENT-S02-REVIEW.md` (5-point contract),
`CONTRACT-REGISTER.md` (CR-06, CR-13, CR-14 open), plan § tenant/fulfilment gates.

## Goal

Define the server-owned availability boundary for Oxygen initiation before any
checkout/chat exposure: a pure policy that answers "may a new application
start here?" and separately "may existing-liability recovery proceed here?".
No `oxygen_enabled` DB column, no shared provider ID, no visible toggle, no
consumer wiring in this slice. No provider calls; no provider contracts invented.

## File set (new only)

- NEW `apps/web/src/lib/payments/oxygen/availability.ts` — the policy.
- NEW `apps/web/src/lib/payments/oxygen/availability.test.ts` — colocated tests.

No other file may change. No `server-only` marker: the module is pure, holds
no secrets, and both future consumers (server route + method-list projection)
must import the same decision contract — same rationale as S-01's unmarked
`eligibility.ts`/`money.ts`. Enforcement lives in the consumers, which are
defined below but NOT built.

## New-initiation contract

```ts
type OxygenAvailabilityReason =
  | 'oxygen_identity_mismatch'
  | 'oxygen_environment_mismatch'
  | 'oxygen_guest_not_allowed'
  | 'oxygen_not_configured'
  | 'oxygen_rollout_disabled'
  | 'oxygen_provider_unverified';

interface OxygenAvailabilityInput {
  merchant: { id: string };                    // trusted, caller-resolved
  customer: { id: string } | null;             // trusted; null = guest
  order: { id: string; merchantId: string };   // trusted locked order row
  environment: string;                         // caller-asserted run env
  expectedEnvironment: string;                 // server-configured env
  policy: { guestInitiationsAllowed: boolean }; // injected; no default here
  rollout: { newInitiationsEnabled: boolean } | null;      // server-owned flag
  providerReadiness: { verified: boolean } | null;         // verified connection
}

type OxygenAvailabilityDecision =
  | { allowed: true }
  | { allowed: false; reason: OxygenAvailabilityReason };

function decideOxygenNewInitiation(
  input: OxygenAvailabilityInput
): OxygenAvailabilityDecision;
```

Rules (evaluated in this pinned order; first fault wins):

1. Binding integrity: empty/whitespace merchant id, order id, or non-null
   customer id, or `order.merchantId !== merchant.id` →
   `oxygen_identity_mismatch`. The order row MUST come from the locked DB row,
   never the request body (composition MUST).
2. `environment !== expectedEnvironment` (exact, empty fails) →
   `oxygen_environment_mismatch`.
3. `customer === null && policy.guestInitiationsAllowed !== true` →
   `oxygen_guest_not_allowed`. The guest product decision is NOT made here:
   the caller supplies it; the future composition root passes `false` until
   the product decision lands (CR-13/product, open).
4. `rollout` null/non-object → `oxygen_not_configured`;
   `newInitiationsEnabled !== true` (strict; truthy non-booleans deny) →
   `oxygen_rollout_disabled`.
5. `providerReadiness` null/non-object → `oxygen_not_configured`;
   `verified !== true` → `oxygen_provider_unverified`. No resolver exists
   until CR-14 closes, so production always denies here today.
6. Else `{ allowed: true }`.

Decisions echo no ids: `{ allowed, reason? }` only (log-safe; pinned by sweep).
Manual guards (no Zod): single-file slice per the handover; `money.ts` precedent.
No currency gate: provider currency is unconfirmed (CR-06) — an NGN gate now
would assume its answer. Explicitly deferred, not forgotten.

## Recovery contract (structurally independent)

```ts
function decideOxygenRecovery(input: {
  merchant: { id: string };
  attempt: { id: string; merchantId: string; environment: string };
  environment: string;
  expectedEnvironment: string;
}): { allowed: true } | { allowed: false; reason:
  | 'oxygen_identity_mismatch' | 'oxygen_environment_mismatch' };
```

Binding-only: same mismatch rules, no other inputs. The function deliberately
accepts NO rollout/readiness flags, so disabling new initiations cannot block
recovery by construction. Attempt existence and caller authority need the
future DB-backed consumer — documented, not built.

## Future consumers (defined, NOT built — no enforcement claimed)

1. **Server initiation consumer** (future route, e.g.
   `POST /api/payments/oxygen/attempts`): authenticate → resolve merchant via
   `get-merchant-for-api-request`/order-bound customer capability → load locked
   order → call `decideOxygenNewInitiation` with server-resolved inputs → 403
   with `{ error, reason }` on deny (Credit Direct 403 precedent), zero
   provider calls. Future enforcement test: denied initiation asserts 403 +
   injected-transport spy never called.
2. **Method-list consumer** (future projection in storefront features /
   `payment-step-availability.ts`): server-computed decision projected to the
   client; Oxygen hidden unless allowed. Must never render as credit approval
   (S-01 D-05). Future enforcement test: projection excludes oxygen on deny.

## Self-critique (challenge areas)

- Authorization: policy trusts caller-resolved inputs; a future caller passing
  client-supplied ids breaks everything. Mitigated by MUST clauses + consumer
  contracts above; residual accepted (no consumer exists to misuse it yet).
- Isolation: merchant binding + exact env match; nested-structure n/a (no
  cache/state). Mismatch priority first so caller bugs surface, not readiness.
- Money/currency: none handled; NGN gate explicitly deferred on CR-06.
- Concurrency/expiry/response-loss/RLS: n/a — pure synchronous, no I/O, no
  clock, no DB.
- Privacy: decisions carry no ids/secrets; module never logs (spy test).
  Inputs are caller-owned ids, never echoed.
- Weak tests: the all-valid `allowed: true` case tests the pure function's
  specified branch with injected inputs — NOT a fabricated provider happy
  path (no provider contract is assumed; production denies at readiness
  today). Multi-fault priority, truthy-non-boolean denial, and the
  recovery-independence property are pinned. Reason strings in expectations
  are the specified API (like error codes), not impl-mirroring.
- No-marker risk: a future client import is *intended* for the method-list
  consumer; server enforcement lives in consumer 1, which is server-only by
  nature. The unwired gate extends to the new module.

## Acceptance criteria

- Behavioural RED per function (tests first, compiling stub failing
  assertions; import failures don't count), minimal GREEN, refactor, re-run.
- Cases: each reason in isolation; multi-fault priority; empty/whitespace/
  cross-merchant bindings; exact env match incl. empty; guest allowed/denied
  via injected flag; null/malformed config objects; truthy-non-boolean flags;
  recovery allowed independent of initiation flags + mismatch denials;
  log-safety sweep (no ids in decisions); console silence; no-import static
  test; unwired gate extended.
- `biome check` clean; owned vitest green; `turbo lint typecheck
  --filter=@baci/web`; CodeRabbit gate; evidence in `TDD-EVIDENCE.md`.

## Out of scope

DB column, shared provider ID, settings UI, toggle, readiness resolver
(CR-14), guest product decision, currency gating (CR-06), both consumers,
orchestration, chat wiring. Design-only review proportionality: this slice is
one ~120-line pure module with no secrets, state, I/O, or concurrency; the
orchestrator implements it inline with TDD and the automated + self-critique
gates above, instead of spending three subagents. Any growth in scope reopens
the orchestration question.
