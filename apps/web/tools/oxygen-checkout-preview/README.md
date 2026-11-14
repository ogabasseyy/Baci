# Oxygen checkout — simulated responses

Run from the integration worktree root:

```sh
pnpm --filter @baci/web exec vite --config tools/oxygen-checkout-preview/vite.config.ts
```

Open `http://127.0.0.1:3432/`. The preview uses the actual reusable React checkout
components with an isolated, in-memory simulation adapter. It loads no `.env`
files, reads no credentials, imports no provider transport or database client,
and makes no payment/provider requests. Refresh/reset starts a new session.
It is not installed as a payment option in the production storefront.

## Flow

1. Review NGN 400,000 sample product, tenure 3 months, with the observed 25%, 30%
   or 35% down-payment examples. Fees and instalments use recorded staging
   examples, not a formula for arbitrary future quotes. See upfront equity,
   charges, instalments, interest and combined total payable.
2. Accept the selected plan. Updating the down payment replaces the simulated
   booking reference and requires acceptance of the new breakdown. Old booking
   actions cannot mutate the replacement.
3. Open simulated payment and repayment-setup dialogs. Return without completing
   either to exercise pending status, or simulate success. Returning queries the
   adapter's completion state; closing a page alone is not completion.
4. Confirm only after acceptance and BOTH completion flags. This confirms the
   simulation, not a real activation. The confirmation explains that Oxygen sends
   the offer letter by email in the live flow. No email is sent by this preview.

After a simulated payment, changing the plan is blocked to avoid teaching a
second-payment flow. Actual expired/paid-booking recovery requires Oxygen's
confirmed reconciliation contract. A status-check error keeps confirmation
blocked and offers a recheck.

## Integration boundary

`OxygenCheckoutFlow` consumes `OxygenCheckoutAdapter`; the current contract is
explicitly simulation-only. It exposes no real activation or settlement method.
The snapshot permanently retains `realActivation: not_requested` and
`settlement: not_verified`. Late responses/dialogs from another adapter/booking
are ignored. Pending actions are locked against duplicate submission.

A future live adapter must perform authenticated server-side operations with
customer/order/merchant binding, durable attempts, approval OTP/signature,
confirmed KYC, payment/setup checks, and indeterminate-result reconciliation.
Do not replace the simulation with direct browser calls to Oxygen or interpret
sample completion as rollout approval. Real activation and merchant settlement
remain separate integrations. Existing availability/initiation guards and live
staging webhook registration were not changed by this checkout preview.

## Verification

```sh
pnpm --filter @baci/web exec vitest run src/lib/payments/oxygen/simulated-checkout.test.ts src/components/payments/oxygen/OxygenCheckoutFlow.test.tsx
pnpm --filter @baci/web exec tsc --noEmit -p tools/oxygen-checkout-preview/tsconfig.json
```

Browser-tested through the full simulated review/payment/setup/confirmation
journey. UI tests cover acceptance, plan replacement, return without payment,
completion gating, status failures, stale responses/dialogs and absence of
network calls. Adapter tests cover snapshots, cross-session isolation, stale
booking rejection and immutable real-activation/settlement boundaries.
