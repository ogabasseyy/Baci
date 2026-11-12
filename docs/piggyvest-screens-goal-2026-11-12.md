# Goal: every PiggyVest screen built, tested end to end, then design-checked

Owner request (2026-11-12): build every screen of the PiggyVest process, test it
end to end (goal creation, goal ending, liquidation, cards, purchasing), then
hand over to a Fable agent that walks the app and screenshots every screen for
design consistency and bugs.

Rules that apply throughout:

- One design language: the savings sheet's in-sheet steps (dots and in-app PIN
  pad, brand red, calm states, no iOS alerts for normal outcomes, sheets fit
  their content).
- Early cancel forfeits interest; complete keeps it (owner 2026-11-12).
- No card funding into PiggyVest, no cash-out, no credits product.
- PiggyVest staging outbound transfers are paused (since 2026-11-09): money
  steps are tested against mocked PiggyVest replies and marked "rerun after
  unpause" (owner: build on what is proven).

## Screens and status

| Stage | Screen | Where | Status |
| --- | --- | --- | --- |
| Shell | Wallet hero card, account number, shortcuts | `WalletHeroSection` | One honest wallet in #4216 |
| Fund | Add money sheet + transfer instructions | `WalletFundModal`, `WalletFundPanel` | **To redesign** |
| Fund | PiggyVest onboarding (BVN, consent, pending) | `PiggyvestWalletSetupPanel`, `PrimaryWalletSetupPending` | **To redesign** |
| Fund | Credit arrives ("Money received") | `use-primary-wallet-credit-poll` (Alert) | **To redesign** (no alert) |
| Save | Start Savings, Check your plan | `StartSavingsScreen` and modals | Redesigned in #4223 |
| Save | Add to savings + PIN step | `WalletSavingsProgressModal`, `WalletPinSheet` | Done (#4215) |
| Save | Goal setup pending / retry / slow notice | `SavingsPlanStatusNote` | Done in #4223 |
| Save | Change phone | `SavingsPhoneSwapStep` | Done in #4224 |
| Save | Variant resolution (completed goal) | `WalletSavingsVariantResolutionModal` | **To redesign** (in-sheet, no alerts) |
| Save | Contribution outcomes ("Add money first", success, pending) | `wallet-screen-savings.handlers` (Alerts) | **To redesign** (inline) |
| Manage | Cancel goal (forfeits interest) | `GoalCancelStep` | Done in #4224; needs #4222 |
| Manage | Complete goal (purchase request) | `GoalCompleteStep` | Done in #4224 |
| Manage | Settings > Wallet PIN | `WalletPinSettingsScreen` | Done in #4224 |
| Manage | Savings notifications | `SavingsNotificationsScreen` | **To review** |
| Manage | Full-page goal-actions route | `GoalLifecycleScreen` | Now unreachable from the app; **retire or redirect** |
| Spend | Checkout "Use device savings" / wallet rows | `PaymentMethodStoreCreditRows` | **To review** |
| Spend | IMEI check paid from the PiggyVest wallet | `app/imei-check` + #4218/#4220 | Server in #4218/#4220; **app step to build** |
| Spend | Airtime/data/power paid from the wallet | `app/utilities/[type]` | After IMEI; **app step to build** |
| Spend | Wallet transactions | `WalletTransactionHistory` | **To review** (no detail view) |
| Clean-up | Orphans: `WalletFundingAccountCard`, `checkout/WalletPayment`, `LocalSavingsDraftScreen`, `PlanWalletStagingSection` | | **Remove** |

## End-to-end test plan (sandbox stack, simulator)

1. New customer: onboarding, BVN, account number.
2. Fund by bank transfer (rerun after unpause), credit shown.
3. Start a plan: Check your plan, create, setup pending to ready.
4. Add to savings with PIN (rerun after unpause).
5. Change phone.
6. Cancel early: interest forfeited (needs #4222; rerun after unpause).
7. Complete: purchase request (rerun after unpause).
8. Checkout using device savings or the wallet.
9. IMEI check paid from the wallet; airtime from the wallet.
10. Settings > Wallet PIN change and reset.

## Design walk-through

A Fable agent walks the same journey on the simulator, screenshots every
screen and state, and lists inconsistencies and bugs; findings are fixed and
re-checked.
