# Isolated customer savings status

Import `CustomerSavingsStatus` from `./customer-savings-status` and its
`CustomerSavingsStatusProps` from `./customer-savings-status.types`.

## Parent contract

- Always supply `device: { productName, variant, condition }` containing the exact
  display descriptor for the authenticated goal's product, variant and condition.
  These are display strings, not provider identifiers. The parent must bind the
  descriptor to the same goal as the server decision; this component cannot verify
  that association. Text is rendered literally through React.
- `status` discriminates `loading`, `unavailable`, `pending_wallet` and `ready`.
  Non-ready states display no balance and no action.
- `ready` requires `decision`, `pendingInterestKobo`, `actionPending` and
  `onReviewPurchase`. The decision is a type-only projection of the existing
  server view decision: `purchasingPowerKobo`, `devicePriceKobo`, `readiness` and
  `purchaseAction`. No server module is imported at runtime and policy is not
  reevaluated in the browser.
- All amounts are nonnegative safe integer **internal ledger kobo**, displayed
  as NGN with 100 kobo per naira. Invalid amounts fail closed to unavailable.
  Supply server-confirmed purchasing power directly; pending interest is never
  added to it. This contract does not define or convert provider monetary units.
- `readPiggyvestSavingsView` returns pending interest from the same internal-ledger
  snapshot used for its decision. `readPiggyvestCustomerStatus` projects that view
  and trusted exact-device labels into serializable display props. Do not substitute
  estimates or provider response fields; provider monetary units remain unconfirmed.
- The review button exists only for
  `decision.purchaseAction === 'requires_customer_confirmation'` and is disabled
  while `actionPending`. A customer click calls `onReviewPurchase()` with no
  arguments. The parent owns pending state, fresh server authorization and any
  later confirmation flow. The callback must open review, not auto-purchase.
- The staging label is unconditional. There is no production mode, rate,
  stock-reservation claim, gift, guarantee, withdrawal or refund control.

The client directive enables the review click handler. Existing `ThemedCard`
and `ThemedButton` supply merchant CSS-variable theming. The component has a
named region, semantic description lists and a polite status announcement.

## Local report

Only four new files in this directory belong to this change: the component,
props type, colocated synthetic RTL test and this report. Existing shared edits
are outside its ownership.

TDD: the initial 18 behavior tests failed against a null-rendering placeholder,
then passed with implementation. Additional coverage checks exact safe-integer
currency precision and removal of stale balances/actions on unavailability.
Final result: 20 synthetic RTL tests passed; scoped Biome checked all three
TypeScript files with no errors. The runtime component is 136 lines.

Scoped validation commands (run from the worktree root):

```sh
pnpm --dir apps/web exec vitest run src/components/storefront/piggyvest-savings/customer-savings-status.test.tsx
pnpm exec biome check apps/web/src/components/storefront/piggyvest-savings
```

The parent loader integration test exercises the actual ledger view and this
component together with synthetic storage. No customer route or production page is
wired yet. No Paystack code, environment files or release operations are involved.
Root checks and TypeScript verification belong to the parent. Synthetic RTL does not verify browser appearance,
real authentication, ledger freshness or end-to-end purchasing. The broader
PiggyVest integration remains incomplete and is not claimed by this component.
