# Oxygen executable-handoff deliverables

Dated 5 October 2026 (Africa/Lagos). Worktree `feat/oxygen-integration` from `main@68903f4`.
Companion to [the integration plan](2026-10-05-integration-plan.md),
[the agent handover](AGENT-HANDOVER.md), and [the contract register](CONTRACT-REGISTER.md).

Status: handoff written; CR-01/02/07 partial per the 6 Oct live auth check
(production pairing only — see the register), all other CRs open, no
question-pack replies. S-01 has local implementation; see REVIEW-2026-10-06.md
for corrected findings, validation and the distinction between provider
blockers and independent local work.

## 1. Product and transition contract

### 1.1 Decided in this handoff (Baci-owned, no provider answer needed)

- D-01 Provider id is `oxygen` (Baci namespace choice, not a provider contract).
- D-02 Money inside the Oxygen contract uses exact integer minor units (kobo for NGN);
  conversions at Baci boundaries reject excess precision and non-NGN currency rather than
  rounding or guessing (slice S-01).
- D-03 Eligibility classification is fail-closed: only the two documented GitBook shapes
  (affirmative sample; 400 + `response_code "99"` pending sample) yield a non-unknown
  outcome. Every other shape — including explicit-looking declines, other 400s, and
  malformed payloads — classifies as `unknown`: neither approval nor decline, automatic
  progression stops (slice S-01). Rationale: the negative schema is unconfirmed (CR-05),
  so any decline rendering would invent provider semantics.
- D-04 No provider transport, credentials, settings flags, routes, migrations, or UI are
  added until their gating CR closes. Unconfirmed operations stay unavailable by absence,
  not by a flag that implies they exist.
- D-05 Local BNPL method availability must never render as credit approval (plan §
  "Current Baci integration map", mobile `isBNPLEligible` note). Any future Oxygen
  availability helper is gated on CR-06/CR-10 product limits, not on the classifier.

### 1.2 Open decisions (Baci-owned and provider-dependent)

- Baci owns checkout/guest policy, whether to select chat, and a conservative initial
  single-item/no-split-funding scope. These need product decisions, not provider permission
  to design. Hosted flow availability, supported funding, and reusable prequalification
  semantics need Oxygen confirmation (CR-13, CR-06, CR-10).
- Chat adapter: design option, not approved scope; requires the same orchestrator plus
  secure handoff if selected (plan § Chat-led integration option).
- KYC/statement stage ordering (CR-04, CR-09); offer acceptance binding (CR-10).

### 1.3 Allowed transitions

Slice S-01 implements pure decision primitives only — no state machine, no transitions.
The full local progression from the plan (created → validation → eligibility → offer →
booked → approval → equity/repayment → activation, with compensating reversals) is
accepted as the design target but NOT implemented: every edge depends on open CRs
(CR-03…CR-12). No transition table is final until CR-05/CR-06/CR-08/CR-12 close.

## 2. Persistence and authorisation design

Design only — no migration is authored in slice S-01.

### 2.1 Reuse, then minimal new storage (phase 2, gated on CR-14)

1. Inventory the payment-ingress foundation at implementation time
   (`20260731140000_payment_ingress_contract_generation_foundation` and successors);
   extend it only if its adapter contract covers a new provider without reinterpretation.
2. Otherwise append one migration creating, per plan § "Attempts and state":
   - `oxygen_connections` keyed by `(merchant_id, provider, environment)` with partner
     identity, merchant reference, credential-secret reference (secret itself in the
     approved secret store, never the row), configuration version, readiness status.
   - `oxygen_attempts` pinned to order version + immutable connection version + stable
     provider account identity, with local step columns kept independent (phone, selfie,
     address, eligibility, offer, financing).
   - `oxygen_action_intents` for durable mutation intents with provider idempotency key
     only as confirmed by CR-12.
   - `oxygen_event_inbox` with unique key on (stable account, environment, provider
     event identity) once CR-08 confirms event-ID scope; conflicting payloads under one
     identity quarantine instead of overwriting.
3. Constraints/indexes: unique active attempt per order version; foreign keys indexed;
   RLS enabled with merchant-owner/staff policies mirroring the Credit Direct settings
   precedent (public-safe availability projection separate from protected records).

### 2.2 Authorisation

- Customer/storefront paths: normal Supabase clients under RLS; order-bound capability
  tokens issued by atomic DB RPCs that lock the order and derive money server-side,
  following `issue_credit_direct_checkout_token` / `set_credit_direct_session`
  (`apps/web/src/app/api/payments/credit-direct/sign/route.ts` at this base).
- Merchant/staff paths: `get-merchant-for-api-request.ts` plus staff permission checks.
- Webhook/worker writes: a constrained worker role with explicit grants, defined and
  reviewed before implementation (CR-08/CR-12). No service-role exception is inherited;
  no public RPC trusting a caller-supplied `verified` flag.
- Credential rotation: resolve current authorised credentials for the pinned stable
  account; rotation changes verification material, never replay identity or loan
  beneficiary (CR-02, CR-08).

### 2.3 Slice S-01 persistence

None. Pure functions only; no database, no RLS, no migration.

## 3. Accounting and recovery design

Design only — no ledger code is authored in slice S-01.

- Funds holder: Oxygen settles directly to the merchant per the commercial requirement;
  The proposed accounting treatment is informational direct-settlement events only,
  contingent on CR-11 confirming the actual funds path. No Baci wallet liability and
  no platform payout fee are created for Oxygen funds (CR-11 must confirm timing,
  beneficiary, reference, reversals).
- Existing `20260723000002_byok_direct_settlements` is a semantic reference: its gateway
  constraint excludes Oxygen and its RPC requires service role, so it is not an
  authorised Oxygen path. A dedicated append-only migration plus adapter follows CR-11.
- Gross/equity/principal mapping, invoice freeze (devices, tax, delivery, discount,
  financed amount, customer equity), and provider-unit conversion all wait on CR-06;
  S-01 converts only between Baci major units and Baci minor units.
- Recovery: indeterminate mutations (timeout, lost response, expired worker lease)
  persist the action intent and reconcile via CR-12 lookup; never blind retry. Without
  CR-12, ambiguous attempts stop for operations review with an assigned owner.
- Fulfilment hold: the Oxygen financing decision is enforced at the shared mutation
  boundary across checkout, payment-method switching, manual ship-on-credit, confirm,
  payment/shipping edits, shipment booking, and mobile-admin (phase 5, gated on CR-06
  dispatch evidence + CR-12). Non-Oxygen credit shipping keeps current behaviour.

## 4. Bounded implementation changes

### Slice S-01 (cleared; this workstream)

| File | Change | Tests |
| --- | --- | --- |
| `apps/web/src/lib/payments/oxygen/eligibility.ts` | Fail-closed classifier over the two documented CR-05 samples (new) | Colocated Vitest: affirmative, pending candidate, other-400, malformed, unknown, contradictory |
| `apps/web/src/lib/payments/oxygen/money.ts` | Exact NGN major↔minor conversion with precision/scale/currency guards (new) | Colocated Vitest: round trips, fractional, max safe, excess precision rejected, non-NGN rejected |
| `docs/partners/oxygen/TDD-EVIDENCE.md` | RED→GREEN→REFACTOR evidence (new) | n/a (evidence log) |

The review moved eligibility Zod schemas into the app schema directory. No migration,
route, shared-contract, UI or dependency change. Major-unit output is decimal text, not
a JavaScript number, to preserve exact kobo at the supported boundary.
Validation scope per the user-supplied instructions and the primary checkout validation
guide (that file is absent in this worktree): affected-package checks for
`@baci/web` (lint, typecheck, affected Vitest files) plus doc consistency checks.

### Slice S-06 (implemented; independent fixes applied 7 Oct 2026)

Checkout/chat interaction shell: one server-derived contract (core
machine + hook glue + panel renderer), unavailable/sign-in from actual
responses, secure-form handoff outside chat, interruption-safe markers.
Six new files + `S06-DESIGN.md` v2; 278 tests; unwired; initiation still
503. Evidence in `TDD-EVIDENCE.md`. No persistence, loan states, terms,
approvals, provider forms, or provider contact. Same affected-package
validation scope.

Independent S-06 fixes: pending handoffs invalidated on unmount/input changes;
loading suspends actions; failed secure-form navigation keeps its marker and offers
recheck only. Manual memoization removed. Final local tests: 595/595; affected lint
and types pass. Final CodeRabbit: 0 issues across 47 files, including runtime
and tests. See `INDEPENDENT-S05-S06-REVIEW.md` for current review evidence.
Hosts must notify session identity changes that preserve authenticated status.

### Slice S-05 (done 6 Oct 2026; all critiques ACCEPT, CodeRabbit clean)

Consumer Phase A: initiation route + availability lookup sharing S-03, exact
customer/staff authorization, deny/503-only, zero writes, zero provider
imports. Ten new files (schemas, context, mappers, two routes + tests). 112
tests; plan `S05-PLAN.md` v2; evidence in `TDD-EVIDENCE.md`; record in
`REVIEW-2026-10-06-S05.md`. No migration, projection, UI wiring, or provider
contact. Same affected-package validation scope.

### Slice S-04 (design-only, done 6 Oct 2026)

Joint initiation-route + method-listing design (`S04-DESIGN.md`): one policy
with three call sites (merchant projection pre-filter, availability lookup,
enforcement route), trusted-context table, 403 message table, enforcement
tests specified but unbuilt. No code, migration, flag, or provider contact.
Implementation gated on CR-14 minimum; further phases per the answer → build
map. Question pack for the partner thread: `PROVIDER-QUESTIONS-DRAFT.md`
(user sends; agent sends nothing).

### Slice S-03 (done 6 Oct 2026; CodeRabbit 1 minor rejected with reason)

Default-off availability boundary: pure policy + binding-only recovery
decision. Two new files:
`apps/web/src/lib/payments/oxygen/availability(.test).ts`. 35 tests; design
`S03-DESIGN.md`; evidence in `TDD-EVIDENCE.md`. No marker (pure and
secretless; both future consumers import the same contract), no DB column, no
shared
provider ID, no toggle, no consumer wiring, no provider contact. Same
affected-package validation scope.

### Slice S-02 (done 6 Oct 2026; all critiques ACCEPT, CodeRabbit clean)

Server-only login transport + token cache on the CR-02 documented sample only.
Six new files: `apps/web/src/schemas/oxygen-login(.test).ts`,
`apps/web/src/lib/payments/oxygen/transport(.test).ts`,
`token-cache(.test).ts`. 101 tests; design `S02-DESIGN.md` v2.1; patterns
`RESEARCH-2026-10-06.md`; evidence in `TDD-EVIDENCE.md`. No migration, no
route, no shared-contract, no UI, no dependency change, no provider contact.
Same affected-package validation scope as S-01.

### Later slices (not started; each needs its CRs closed first)

- Settings slice: shared `payment-method-settings.ts` + `merchant-features.ts`
  defaults + projections/consumers (dashboard payments settings, storefront
  features, availability helpers, mobile-admin screen, mobile-storefront
  params). Gated on CR-14 + phase-1 product decisions. Touches shared runtime
  → full monorepo checks.
- Persistence slice: phase-2 migration + RLS/worker grants + disposable-DB
  checks. Gated on CR-14, CR-08 (event-ID scope).
- Adapter/orchestration/webhook/reconciliation/mobile/acceptance per plan
  phases 3–7, each slice gated on its CRs. Provider-amount conversion needs
  CR-06; webhooks and fulfilment need CR-08/CR-12/CR-06; sandbox runs need
  CR-01/CR-15 plus separate authorisation.

## 5. Blocked-work register

No question-pack replies have arrived; CR-01/02/07 are partial per observed
live evidence (production pairing only — see the register), all other CRs
fully open. The next provider-side action is the user's: send
`PROVIDER-QUESTIONS-DRAFT.md` in the existing partner thread and record dated
answers in the register. Next code per the current prompt: S-05 consumer
Phase A (initiation route + availability lookup, deny/503 only, no writes,
no provider calls); readiness resolver, attempt persistence, and provider
invocation still need CR-14/CR-12/CR-01-test-env. No end-to-end, sandbox,
staging, or production claim is made.


## Independent S-02 follow-up

Read [INDEPENDENT-S02-REVIEW.md](INDEPENDENT-S02-REVIEW.md) before continuing. It records
two further regression-tested fixes, a timeout-configuration guard and 168 passing tests. Availability design must
account for the absence of an existing Oxygen configuration field; do not infer one
from the earlier recommendation to reuse configuration patterns.


## Latest live-access result

The user authorized a production-key login check. It failed with HTTP 400 and
`invalid login credentials`; no token or dependent test was obtained. Read
[the dated check](PRODUCTION-AUTH-CHECK-2026-10-06.md) before retrying. Confirm the
API/account/environment mapping with Oxygen; do not repeatedly retry or create loans.


## Latest environment correction

The user clarified that the published `/v1/partner/login` URL is Development. The
earlier HTTP 400 came from production keys paired with this Development endpoint.
Use Development Partner credentials for the next authentication check; do not treat
the failed mismatch as evidence of faulty production credentials. CR-01 is partially
clarified; no successful Development login or end-to-end acceptance is established.


## Current live authentication status — supersedes earlier failure conclusions

Actual production dashboard keys authenticate at the user-supplied
`https://api.oxygenx.africa/services/partners/v1/partner/login` (HTTP 200, Bearer,
300-second expiry). Authenticated bank lookup succeeds with 44 banks. Earlier 400
results used browser redaction markers instead of actual keys; those conclusions
are withdrawn. Read [the corrected check](PRODUCTION-AUTH-CHECK-2026-10-06.md).
Do not send the obsolete invalid-credentials escalation. No credentials were saved;
future live checks must use a secure authorized source. Environment/account mapping
for the full integration and outstanding financial contracts still apply.

## User-authorized manual production probe — 7 October 2026

The user explicitly selected production for their own manual create → OTP → selfie
→ eligibility test. `MANUAL-TEST-UI.md` records the local loopback runner and limits.
This supersedes D-04's blanket absence rule only for that operator tool, not for
checkout activation or durable financial orchestration. The customer-facing shell
remains unwired and its initiation route remains 503/no-write.

New tooling and schema are isolated from app routes: explicit environment selection,
server-memory credentials and references, manual controls, sanitized response shapes,
origin/CSRF checks and no booking/approval/activation endpoints. One participant and
one create per process run; response loss blocks recreation. Credentials were not
available in the signed-out portal at implementation time; no live provider call was
made by this work. Browser rendered the production-labelled screen with authentication
and actions disabled until credentials are configured. 609 tests pass (595 previous
+ 14 probe/browser tests); affected web lint/types pass. See the manual-test note for
final reviewer evidence and credential setup instructions.
