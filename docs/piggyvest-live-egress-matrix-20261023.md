# PiggyVest egress and reuse matrix

Baseline: `6e0d7083a5ac40a65464c2d3d0cf122e6d9de28c`. Source evidence only unless marked otherwise. Hosted API routes execute on Vercel when their feature configuration is enabled; source reachability is not evidence that the feature is currently enabled. No caller has been moved by this patch.

Paths below are relative to `apps/web/src/`.

| Entry | Existing operations and code to reuse | Target and verification still required |
| --- | --- | --- |
| `app/api/storefront/customer/wallet/piggyvest-primary/route.ts` | Auth/CSRF, resolved identity, `primary-wallet-onboarding.ts`, provider customer creation, wallet/accounts GET and scoped mapping verification | Operation-specific VPS boundary preserving user/merchant authority, idempotency and unknown outcomes; route tests already colocated |
| `app/api/storefront/customer/savings/primary-provisioning/route.ts` | `primary-savings-provisioning-runtime.ts`, wallet creation, retrieval, funding-account retrieval and existing recovery/pagination | VPS execution with existing goal identity and deterministic provisioning; no blind create retry |
| `app/api/storefront/customer/savings/primary-transfer/route.ts` | `primary-wallet-savings-submission-runtime.ts`, `primary-wallet-savings-status-runtime.ts`, existing transfer claims, retrieval and recovery | Both POST submission and GET recovery need fixed egress; read-status paths may submit reclaimed work, so cannot be treated as side-effect-free probes |
| `app/api/storefront/customer/wallet/piggyvest-plan/route.ts` | `plan-wallets.ts` and client | Audit legacy ownership and activation before migration or retirement; do not drop its callers |
| `app/api/webhooks/piggyvest/route.ts` | Key union, primary family dispatch, existing bank/interest/custody stores, legacy restriction-lift retrieval | Receiver family dispatch on VPS, preserving all existing families or approved endpoint separation; relay helper is implemented but deliberately unwired |
| `scripts/primary-wallet-paid-interest-inbox-worker-cli.ts` | Existing approved/readiness/once controls and `drainPrimaryWalletPaidInterestInbox`; paid-interest dispatch retrieves provider wallet | Reuse on VPS after host-binding adaptation and scoped evidence-role provisioning; source CLI presence does not prove a timer is installed |
| `primary-wallet-bank-inbox-worker.ts` | Signature/digest recheck, lease claims, existing SQL process/retry | Reuse; runtime drain differs from intake enable flag. Group roles exist; expected login roles were absent at inspection |

Additional candidate primitives: `customers.ts`, `wallets.ts`, `wallet-funding.ts`, `wallet-interest.ts`, `transfers.ts`, `schedules.ts`, `plan-wallets.ts`, direct provider-request helpers and worker/tool entrypoints. The initial import traversal finds candidates, including type-only imports; each operation must be semantically checked. No complete-coverage claim is made yet.

The generic customer funding-account route uses other payment-account helpers and is not automatically a PiggyVest API caller. Resolve its provider dispatch before moving it. Do not redirect Paystack flows merely because they share the wallet screen.

For each unresolved row, implementation must record exact authentication propagation, database role, existing tests, configuration reader, safe transport schema, timeout/idempotency behavior and deployment evidence before wiring it. A relay credential authenticates the webhook hop only and must never become customer authorization or a generic provider proxy.
