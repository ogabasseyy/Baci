# Oxygen checkout staging review

This PR captures the transferred, previously uncommitted Oxygen checkout integration and its reusable OTP, saved-plan, payment recovery, selfie and phone-handoff UI. It also carries the local cart/rendering and shipping-client fixes used to reach the actual storefront checkout. No private runtime configuration, unlock key, signed provider URL, customer data dump, or generated runtime logs are included.

## Current boundaries

- Normal customer authentication/RLS and explicitly bound worker identities govern workflows.
- Production runtime connection is disabled. Generic activation and settlement contracts remain literal false.
- Automatic NIN submission is paused. A selfie confirmation cannot clear an existing indeterminate command.
- No migration, callback registration, provider mutation, merge or deployment is authorized merely by opening this PR.
- The explicit operator activation trial is separate from ordinary checkout, constrained to its staging owner-approved trial contract, and is not part of automated checkout testing.

## Selfie and mobile handoff

Initial OTP success prepares the existing application's selfie link and automatically opens it in the same checkout modal. Only a provider KYC status of `DONE` completes selfie verification. The provider's `FACE_RECOGNITION_SUCCESS` window message is an origin/source-checked hint to read KYC, never proof of completion. The deployed error modal did not expose a parent failure event, so phone fallback remains available without inferring camera errors from a cross-origin iframe.

Selecting the phone option automatically prepares a local QR without a second click. A short countdown and expired-code recovery replace stale codes. A successful QR refresh restarts the bounded status watch. Scanning the phone link automatically exchanges its single-use fragment token and navigates directly to Oxygen; no extra confirmation card is displayed.

The optional Python helper under `apps/web/tools/oxygen-local-selfie-handoff` is temporary local staging infrastructure. It exposes only the handoff page and exchange, uses a separate loopback-only issuer, stores hashed tokens in memory with at most five-minute expiry, and adds no browser QR dependency. Production requires a separately approved public deployment and shared durable storage. Oxygen's staging `frame-ancestors` policy currently permits localhost:3000; exact staging frame/camera delegation is local-only.

## Validation and remaining gates

Focused Oxygen API/runtime/UI tests, deterministic Python handoff tests, changed-file Biome, and web TypeScript are recorded in the PR description. The broad Oxygen run currently has three stale approval/payment UI expectations in `OxygenOfferCompletion.test.tsx` and `OxygenSavedPlans.test.tsx`; the full suite is not green.

CodeRabbit uncommitted review was attempted but returned a rate-limit error: three included reviews were exhausted and usage-based review requires a seat assignment or Agentic API key. That review gate remains blocked. Do not merge or deploy this draft on the strength of local targeted checks alone. Database SQL regressions and production browser/CWV checks require their own evidence; staging UI or a mock success is not production validation.
