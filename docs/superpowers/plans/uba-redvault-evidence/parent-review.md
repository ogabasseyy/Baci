# Parent review ledger

## Step 1 continuation — 12 September 2026

Supersedes the 917-only and historical-replay-pending dispositions below. Parent passed ordered native migrations 900–923, including concurrent approval/refund and real fulfillment/inventory RPC regressions. Both chronological and production-effect historical Supabase PG17 runs pass enforced convergence and current-tree schema/RLS/grant checks. No remote migration or production attestation occurred. Full-patch review batches completed; parent/agent corrections include item reparenting protection, refund fulfillment holds, canonical rounding groups, and mobile late-response cancellation after pending dismissal. Scoped review accepted the corrected mobile lifecycle. Full-suite acceptance remains distinct; current test outcomes and clean approved-tree blockers are recorded in `step-1-review.md`. Availability stays disabled; no commit, deployment or real payment occurred.

## Phase 0 remediation review

Verdict: ACCEPTED to unlock Phase 1 shared pure calculation only. This is not database/payment implementation acceptance or release readiness.

Reviewed workspace: `/Users/mac/Baci-app/.worktrees/ogabassey-uba-redvault-phase-0`.
HEAD: `449e604c434f7a9996e7284acf0dfd6c190f0187`.

Reviewed SHA-256 manifest:

- `phase-0.md`: `4b930038b7f4fd860fc8d1a846b64170df4d49cf67af2a06af8a79f4fbe49de7`
- `2026-09-11-ogabassey-uba-redvault.md`: `ba1aa701d033c4f1ec3d63b885743a7e9853a93b3de3eee9d6c35c95b581b95c`
- `2026-09-11-ogabassey-uba-redvault-phased-handoff.md`: `f09932dcdc4ccd9100bebf73ae5da9e9ea865025cca40a1946acb55fb7820a3a`

The four requested corrections are addressed: actual baseline, mandatory signed order/quote identities, unknown-eligibility hold, and concrete guest/VAT/item identity conventions. Parent checked the report hash, checkout guest sentinel, scoped JWT role/sub behavior, item ordinal and VAT representation against source. No feature tests were run for this documentation-only review.

Ruling: use the isolated detached workspace without creating a branch. Preserve the unrelated modified `supabase/.temp/cli-latest`; it is outside accepted artifacts. Documentation remains untracked. No commit, push, deployment, real payment or production access is authorized.

Ruling: Phase 0's explicit Phase 1 ownership names govern, not the readiness sidecar's alternative filenames. Phase 1 owns redvault-eligibility, redvault-pricing, redvault-refund-allocations, the redvault-quote contract and necessary shared exports/tests only.

Later gates remain mandatory: exact SQL grants and lock ordering across all callers, unpayable draft lifecycle, immutable allocation binding, provider eligibility evidence and settlement controls must be validated before their respective phases can be accepted. Neither requested filters nor a mocked eligible result proves actual provider enforcement. Commercial terms remain unresolved and activation disabled.

| Phase | Status |
| --- | --- |
| 0 | ACCEPTED for Phase 1 dependency |
| 1 | Authorized for scoped Terra implementation; parent review required |
| 2–5 | LOCKED pending preceding phase acceptance |

## Phase 1 review and continuous execution

Owner now requests full local implementation without further per-phase prompts; parent review gates remain. Phase 1 ACCEPTED for Phase 2. Parent inspected pricing/refund contracts, found unbounded per-unit allocation and inclusive-tax drift, requested correction, verified the cumulative 10,000-unit technical resource bound before array allocation and exclusive-only tax contract, and reran four focused suites: 41 tests passed. This is a technical memory bound, not a campaign/customer commercial cap.

Reviewed HEAD remains `449e604c434f7a9996e7284acf0dfd6c190f0187`. The complete Phase 1 file manifest is in `phase-1.md`, whose reviewed SHA-256 is `dd2e3ee03050c44f537214e064ee822916dcf74a66a760f76cfc0b334abea762`. Parent `git diff --check` passed. Agent scoped typecheck/Biome passed; aggregate test exit and CodeRabbit final verdict are not confirmed and remain final integration evidence requirements.

Phase 2 is authorized for its specified backend/SQL scope only. All later phases still require dependency acceptance. No deploy/remote migration/real payment/activation authority is granted.

## Accelerated independent preparation

Under the owner's full-implementation request, isolated presentational web/mobile REDVAULT components and colocated tests may be prepared in parallel using the frozen server summary. They must not be wired into checkout, exported through live routes, make network calls, compute authoritative prices, or enable the offer. This narrows the original Phase 4 dependency to integration: actual checkout integration remains locked on Phase 3 acceptance. Cost of this ruling is possible component rework if the backend contract changes; it does not permit payment or tenant-security bypasses. Shared/backend/SQL ownership remains serial.

## Phase 2 parent review

ACCEPTED for Phase 3 local development, not production readiness. Parent checked the manifest successfully, reviewed draft/attach/route boundaries and corrected test-helper behavior, and independently executed `node supabase/migrations/tests/run-redvault-native.mjs`: passed, including concurrent fresh retries and owned-cluster cleanup. The helper's original false-positive negative tests are superseded by the corrected version and its self-test. Phase 2 manifest SHA-256: `86ca49e3f2a53deeaf2c00604fc8b13c012e264ba6a0afc6576a330b4a6a121d`; baseline HEAD unchanged. Agent reports 158 focused tests and successful repo lint/typecheck.

Coverage ruling: native PG18 tests execute new SQL and real hash/HMAC definitions but model legacy order creation and Supabase auth. This is sufficient evidence to develop the next disabled backend phase, not evidence of compatibility with all production PG17 inventory/shipping/tax triggers. Full Supabase replay and aggregate regressions remain release blockers; do not describe native fixture success as full database validation.

Phase 3 owns payment attempts/completion/recovery/refunds, additional reviewed migrations and final UI-facing order summary contract. It must preserve protected-order paid-transition guards while adding atomic approved completion. Unverified issuer eligibility stays held, and default-disabled runtime remains. All real provider operations/production deployment remain prohibited.

Independent UI preparation: parent reran web component suite, 7 tests passed. Mobile worker reports 8 Jest tests passed after disabling Watchman for focused execution. Both remain isolated and unintegrated pending Phase 3 acceptance.

## Owner-requested implementation acceleration and demo removal

Owner explicitly rejected the standalone demo and requested deletion plus complete actual checkout implementation. Parent deleted its four authored harness files, generated build and demo report, and confirmed the directory absent and loopback server stopped. Do not recreate a demo.

Ruling: actual web/mobile wiring may now proceed concurrently against the documented Phase 3 contracts, but only with server-owned unavailable-by-default gating and mocked integration tests. This supersedes the earlier no-wiring sequence restriction; it does not waive backend or final integration acceptance. Web owns its checkout and a new read-only availability endpoint; mobile owns its own checkout/order payloads. Payment/SQL writers remain disjoint. Risk is interface rework; no live activation or real charge is authorized.

Phase 3 initialization is implemented and agent-reported tested; capture/refund combined SQL and route response review remain pending. No Phase 3 or Phase 4 acceptance is recorded yet. Full implementation/readiness remains unclaimed.

## 12 September final local integration review

Supersedes the preceding progress snapshot. Actual web/mobile checkout wiring, complete persisted totals, protected initialization, held capture handling, stored-net refund transport/lookup, capture lock-order correction, and fenced lookup-lease recovery are implemented locally. The standalone demo remains deleted. Parent independently passed the native fixture through 911 and the attempt-concurrency harness, 587 backend tests, 798 web checkout tests before the callback follow-up, 59 final refund/summary tests, and 46 mobile tests. Aggregate lint and typecheck pass. Callback follow-up evidence is recorded in phase-4a and integration-review.

Acceptance remains PARTIAL, not release acceptance. Full monorepo tests are not green. The live boundary verifier rejects the new initialization signer paths and frozen orders-route drift; no governance controls were relaxed. Phase 3 release acceptance is BLOCKED pending reviewed authority scope and verified provider eligibility/settlement contract. Phase 4 local wiring is reviewed but does not authorize activation, device acceptance, or a successful-payment claim. The positive eligible capture/redemption path and authorized operational transport remain explicit incomplete release work. See `integration-review.md` for consolidated evidence and exact remaining gates.

## Verified-payment evidence contract

Capture owner recorded the normalized successful-payment evidence contract in `verified-completion-contract-proposal.md`. Parent has now confirmed the documented Paystack verification fields; the adapter remains injectable and production callers remain disabled until finalizer integration and the remaining external gates are accepted.

## BLOCKED — verified completion hardening

Parent verified the official Paystack sources on 12 September, so the contract now accepts only a server `GET /transaction/verify/:reference` response with top-level API success and `data.status = success`. It binds documented `data.reference`, `amount`, `currency`, `channel`, `domain`, `authorization.channel`, `authorization.brand`, `authorization.bank`, and `customer.email`. No BIN, PAN, last4, authorization code, callback/body boolean, or invented `authorization.bank_code` participates in eligibility.

The append-only migration `20260912091300_uba_redvault_verified_completion.sql` persists the server-created bank/card-brand/issuer filter policy and hash when reserving a new attempt. Its service-role-only `approve_and_complete_uba_redvault_payment` RPC requires a held capture plus normalized verified evidence, rechecks immutable attempt/order/merchant/customer/reference/currency/amount bindings, and atomically records a private redemption, approves the application/attempt, completes the transaction, and pays the order. It is idempotent for identical evidence and rejects conflicting replays. Ordinary settlement remains unable to use this RPC or bypass the held state.

Migration `20260912091400_uba_redvault_verified_completion_hardening.sql` supersedes the unsafe portions of 913 without editing it. It requires exact JSON types for every evidence value; freezes and hashes bank, brands, issuer, and the expected `test`/`live` verification domain; binds that domain in both the normalizer and RPC; rejects quote drift, cancelled/refunded orders, invalid transaction states, and held attempts with pending/processing/processed refunds. It returns `{ kind, duplicate, completion }`, where `completion` is the exact established `complete_order_gateway_payment` receipt. The successful path invokes that established atomic RPC under the REDVAULT write context so it seeds normal paid-order side effects and derives flags from locked state; replay returns the persisted receipt verbatim.

The parent-owned native runner was restored and is not modified. Required parent runner additions are: apply migrations 913 then 914 after the existing fixture migrations; extend the native `orders` fixture with the completion RPC columns (`cancelled_at`, `amount_paid`, `paid_at`, `updated_at`, `order_number`) and `transactions` with `gateway_response`/`updated_at`; load the established completion RPC and payment-side-effects fixture; run `redvault-verified-completion-914.sql` after held capture and before positive approval; then add policy-hash tampering, frozen bank-code return after runtime change, and each refund-race direction.

Current focused gate validation remains passing; 914 is deliberately not labeled ready until the direct native regressions above execute against the parent-owned runner.

Unresolved release gates: availability remains disabled; parent still owns finalizer/route integration; Paystack/UBA issuer coverage and supplied-range evidence, provider-side settlement control, commercial terms, historical Supabase replay, full aggregate tests/review, and authorized nonproduction end-to-end testing remain required. No migration was applied remotely and no real payment, deployment, or activation occurred.

## Current continuation — finalizer connected, atomic inventory verified

Supersedes the preceding implementation-blocked snapshot. Parent has connected fresh Paystack verification to the ordinary finalizer through a dedicated REDVAULT resolver, strict context/approval schemas and the service-role-only context RPC. Atomic inventory confirmation is SQL-backed, not inherently application-only: migration 916 executes the established completion and inventory RPC in one outer transaction. Missing inventory proof or confirmation failure cannot leave a redeemed approval attached to an unpaid order. Migration 917 additionally rejects null/invalid transaction status. Generic inventory rollback is skipped only for a parsed atomic inventory receipt; replay projects the database duplicate flag into non-first-completion flags and preserves established outbox retry behavior.

Parent independently passed native/ordered fixtures through 917 and focused REDVAULT/finalizer tests (36 files / 267 tests). Independent TypeScript and SQL reviews accepted the atomic-inventory correction. Actual checkout discount-switching wiring was reviewed and rerun successfully. The local-test recovery slice is accepted. True concurrent approval/refund coverage now passes, including refund-first and approval-first blocking and duplicate approval. The full monorepo result is not green: five of six tasks passed, with web failure triage recorded in `verified-finalizer-integration.md`. External provider, production-role, commercial, full Supabase replay and actual device acceptance gates remain unchanged. No activation or production deployment occurred.
