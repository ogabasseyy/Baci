# Saved plans and agent-assisted checkout

## Implemented boundary

Order details read the authenticated customer's saved Oxygen workflow and project only upfront amount/confirmation, tenure and payment dates. This read neither calls Oxygen nor creates a workflow. RLS scopes the workflow lookup and the status RPC rechecks ownership. Identity, bank details, signed payment links and provider references are not returned. Saved schedules do not establish which monthly payments have been made.

Oxygen has reportedly wiped the staging application. Existing local records remain historical evidence; do not reset or reuse their provider references for new mutations. Start a new cart/order through the normal UI for the next test, preserving old applications and indeterminate attempts. General activation and settlement remain disabled; do not extend the completed single-booking trial to the new application.

## Remaining provider wiring

- Confirm the production transaction callback's exact meaning and delivery contract using an observed payment. Authenticate, persist and reconcile callbacks by unique reference; do not trust iframe closure as proof of payment.
- Obtain the authoritative instalment-history/outstanding-balance endpoint and monthly repayment callback contract. Until then show saved dates and explicit unknown repayment status.
- Confirm Oxygen's reminder/collections ownership and customer support destination before adding reminder promises or links.
- Verify merchant settlement separately from approval/activation before marking the order funded or initiating fulfilment. No settlement mutation or production deployment is part of this work.
- Keep reset application recovery explicit. A local saved state must not cause automatic booking or approval retries against wiped provider records.

## Agent experience

Reuse `chat-pipeline.ts`, the authenticated `/api/payments/oxygen/chat` continuation endpoint, and the shared web/mobile/chat workflow. Current chat implementation is safe continuation/projection, not a complete model-driven checkout agent.

An agent can discover products, help compare provider-confirmed saved plans, explain next steps and open the existing secure checkout at the correct stage. Customer identity input, selfie, signature, consent, OTP and payment stay in the secure UI. Agent tools must use the same ownership checks, idempotency keys and durable state transitions, with no generic provider proxy or model-selected tenant identity. Never send BVN/NIN, OTPs, biometrics, bank details or signed URLs into model context.

Before implementation, choose the first agent surface (storefront chat or a dedicated chat app). Default recommendation: storefront assistant that opens this existing checkout popup; mobile/chat handoff can follow once the same contract is proven. Production activation requires its own approved exactly-once orchestration and evidence gates; it is not enabled by this design.

## Local verification, 31 October 2026

Order details now use a small server page with a Suspense-wrapped request marker, preserving the client loading shell and permitting request-bound merchant metadata. Browser verification showed the saved three-payment plan and no issue badge. Expired portable anonymous staging access was renewed with unchanged claims/role; customer credentials and provider records were not reset.

Targeted rendering/order-plan tests: 13 passed. Web package typecheck passed. CodeRabbit review was attempted but blocked by exhausted allowance and no seat assigned to this Git account; no review-completion claim, commit, merge or deployment. Fresh test starts with one Samsung A16 in the normal cart; new provider submission and consent remain user steps.
