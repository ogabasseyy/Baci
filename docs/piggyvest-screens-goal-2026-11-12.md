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
| Fund | Add money sheet + transfer instructions | `WalletFundModal`, `WalletFundPanel` | Done in #4230 (outcomes are the wallet notice in the sheet; questions are an inline card; no iOS alerts) |
| Fund | PiggyVest onboarding (BVN, consent, pending) | `PiggyvestWalletSetupPanel`, `PrimaryWalletSetupPending` | Done in #4230 (calm review card; offline/retry state on a failed check) |
| Fund | Credit arrives ("Money received") | `use-primary-wallet-credit-poll` | Done in #4230 (success wallet notice, no alert) |
| Fund | Wallet activity under the card | `WalletTransactionHistory` | Retitled "Older store credit" in #4230; **PiggyVest activity list owed**: needs a new server read (all PiggyVest ledgers deny customers; IMEI/VTU wallet spends not recorded yet) |
| Save | Start Savings, Check your plan | `StartSavingsScreen` and modals | Redesigned in #4223 |
| Save | Add to savings + PIN step | `WalletSavingsProgressModal`, `WalletPinSheet` | Done (#4215) |
| Save | Goal setup pending / retry / slow notice | `SavingsPlanStatusNote` | Done in #4223 |
| Save | Change phone | `SavingsPhoneSwapStep` | Done in #4224 |
| Save | Variant resolution (completed goal) | `SavingsVariantPickStep` (modal removed) | Done in #4224 (in-sheet, no alerts) |
| Save | Contribution outcomes ("Add money first", success, pending, still checking) | `savings-notice`, `WalletPendingSavingsContribution` | Done in #4224 (inline notices, auto-check) |
| Manage | Cancel goal (forfeits interest) | `GoalCancelStep` | Done in #4224; needs #4222 |
| Manage | Complete goal (purchase request) | `GoalCompleteStep` | Done in #4224 |
| Manage | Settings > Wallet PIN | `WalletPinSettingsScreen` | Done in #4224 |
| Manage | Savings notifications | `SavingsNotificationsScreen` | **To review** |
| Manage | Full-page goal-actions route | `app/wallet/savings/goal-actions.tsx` | Retired in #4224: old links open the in-sheet steps |
| Spend | Checkout "Use device savings" / wallet rows | `PaymentMethodStoreCreditRows` | **To review** |
| Spend | IMEI check paid from the PiggyVest wallet | `app/imei-check` + #4218/#4220 | Built: server #4218/#4220, app #4225 |
| Spend | Airtime/data/power paid from the wallet | `app/utilities/[type]`, `VtuWalletPayHost` | Built in #4227 (dark, on #4225); **Fable walk owed** after it absorbs #4222's executor change |
| Spend | Wallet transactions | `WalletTransactionHistory` | **To review** (no detail view) |
| Clean-up | Orphans: `WalletFundingAccountCard`, `checkout/WalletPayment`, `LocalSavingsDraftScreen` (+ history, review, draft hooks), `PlanWalletStagingSection` | | Removed in #4224 |

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

## Walk-through results (2026-11-13)

A Fable agent walked the combined build (`e2e/piggyvest-all`: #4216, #4222,
#4223, #4224) on the iOS simulator against the local sandbox stack. It
reached about half the journey. The test goal's setup never finished, so
amount entry, the in-sheet PIN step, Complete goal and the checkout payment
step were not reached. Screenshots are kept locally (not committed).

| Finding | Severity | Owner | Status |
| --- | --- | --- | --- |
| Cancel goal on a goal whose setup never finished fails with "Could not confirm" (server: no savings destination → 503) | High | #4222 session | Sent 11-13 |
| Pending setup: "about a minute" copy forever, no Check now | High | #4223 session | Sent 11-13 |
| "Keep saving" flashes a live amount entry before the pending state | High | #4223 session | Sent 11-13 |
| Keyboard covers the whole Change phone sheet | High | #4224 | **Fixed** (0c398f28d6), re-checked on the simulator |
| Wallet card looks ready while setup is pending | Medium | #4223 session | Sent 11-13 |
| One balance with three names; "Total savings" vs "Savings ₦0" | Medium | #4216 session | Sent 11-13 |
| No Add money entry on the wallet; copy gives no feedback | Medium | #4216 session | Sent 11-13 |
| Wallet tab stuck under a refresh spinner once | Medium | #4216 session | Sent 11-13 |
| Wallet PIN change rejects a wrong current PIN only at the end | Medium | #4224 | Kept: checking it early needs a new server PIN check (another PIN-guessing door); the change is refused safely and restarts at step 1 |
| Floating AI button covers PIN, settings and notification controls | Medium | #4224 | **Fixed**: hidden on Settings and Notifications |
| Airtime: iOS alert, Pay enabled without credit; Add store credit return | Medium | #4225 session | Sent 11-13 |
| Notifications: title differs from the Account row; orders link covers empty state | Medium | #4224 | **Fixed** |
| "Recent Transactions" empty for a funded wallet | Medium | #4216 session | Sent 11-13 (may be how the test wallet was funded) |
| "No Image" placeholder in Change phone; "Saving for now" label | Low | #4224 | **Fixed**, re-checked |
| Back from "Choose a new PIN" leaves the flow | Low | #4224 | **Fixed** |
| "Confirm it's you" repeats itself | Low | #4224 | **Fixed** |
| Quiet-hours copy is technical | Low | #4224 | **Fixed** (copy); free-text time fields kept |
| "New" badge overlap; spare space under the sheet | Low | #4223 session | Sent 11-13 |
| IMEI "Retry" looks like text; header back buttons differ | Low | #4225 session | Sent 11-13 |
| PIN boxes grow from 4 to 5 | Low | — | Kept: PINs are 4 to 6 digits, same pad as the in-sheet PIN step |
| Version label mismatch (Account 1.0.0 vs Settings 2.0.1) | Low | — | Not PiggyVest; noted |

Still to walk once the owning PRs land and staging outbound transfers
resume: Start Savings, amount entry and the in-sheet PIN, Complete goal,
funded Cancel breakdown, Add money sheet, checkout payment step, IMEI and
airtime paid from the wallet.

## Second walk-through (2026-11-13)

The second walk-through ran on the updated combined build (#4216, #4222's
not-set-up fix, #4223 and #4224), signed in as the sandbox test customer.

Confirmed fixed:
- Pending plan card ("Getting your plan ready", "View plan").
- One balance name ("Savings wallet") and an Add money button.
- No amount-entry flash.
- "New" badge and sheet spacing.
- Cancel on a plan that was never set up: "This plan is still being set
  up, so there's nothing to cancel yet." with no retry and no PIN.
- Change phone: phone icon instead of "No Image", and the sheet lifts above
  the keyboard.
- Notifications: title, orders link position and quiet-hours copy.
- No chat button on Wallet PIN; App Settings keeps it.

| Finding | Owner | Status |
| --- | --- | --- |
| "Check now" and the pending copy depend on when the sheet opened, not how long setup has been pending | #4223 session | Sent |
| Slowdown banner: edge to edge, no gap, shown twice while the sheet is open | #4223 session | Sent |
| Account-number copy gives no "Copied" feedback | #4216 session | Sent |
| Stacked `/wallet` screen has no back button or tab bar; two wallet header styles | #4216 session | Sent |
| Back from "Forgot your PIN?" left the flow | #4224 | **Fixed** (ef05a7e526) |
| Quiet-hours summary in 12-hour time, fields in 24-hour | #4224 | **Fixed** |
| Change phone search: auto-capitalise and suggestion bubble; wide placeholder | #4224 | **Fixed** |
| Cancel review says "You'll confirm with your wallet PIN" for a plan the server then refuses | #4224 | Kept: the review can't know setup state; the refusal message is clear |
| "4 to 6 digits" while 4 boxes show | #4224 | Kept: the boxes grow as digits are typed (same pad as the in-sheet PIN step) |
| Chat button covers the end of some rows (Settings chevron, Notifications text) | #4224 | Kept on purpose: Muse asked to keep in-app help on these screens |
| White band clipping the last row on Notifications and App Settings | — | Not a bug: the list scrolls behind the home-indicator safe area; the row shows in full when scrolled |

Still owed: money steps (Add to savings with PIN, Complete goal, funded
cancel breakdown, checkout and wallet payments) once PiggyVest staging
outbound transfers resume and a plan finishes setup.

## Third walk-through (2026-11-13)

Confirmed fixed on the simulator:
- "Copied" feedback on the account number (#4216).
- Stacked wallet back button and matching header (#4216).
- "Check now" and "taking longer than usual" on the first open (#4223).
- Slowdown banner aligned and shown once (#4223).
- Change phone search stays lowercase (#4224).
- Quiet hours in 24-hour times (#4224).
- Back from "Forgot your PIN?" returns to "Enter your current PIN" (#4224).

| Finding | Owner | Status |
| --- | --- | --- |
| Cold open briefly shows the ready "Add to savings" card before the pending state | #4223 session | Sent (medium) |
| Slowdown banner arrives 10–30 s after the sheet opens | #4223 session | Sent |
| Sheet titled "Add to savings" while the card says "View plan" | #4223 session | Sent |
| "Copied" label nudges the wallet card down ~4pt for 2 s | #4216 session | Sent |
| Backing out of Forgot PIN could later submit an abandoned reset PIN (Codex P1) | #4224 | **Fixed** (b9985072ce) |
| Sheet grows as "Cancel goal" and the banner arrive; App Settings' Security row appears after first paint | — | Noted (loading order, low) |

## Money walk-through on a local mock PiggyVest (2026-11-13)

Live PiggyVest staging transfers are paused, so the money steps were walked on
the simulator against a local stand-in built from the repo's mock sandbox
(local only, never committed).

Confirmed end to end:
- Add to savings with the PIN.
- Change phone.
- Cancel: the saved ₦52,000 came back; the ₦1,000 interest stayed and wasn't
  refunded.
- Complete: ₦250,000 moved to the wallet; purchase request sent.
- Server and mock balances matched the app.

| Finding | Owner | Status |
| --- | --- | --- |
| PIN step closed the whole savings sheet (Gorhom `snapToPosition` reads as closed) — every money action | #4224 (bug from #4215 on main) | **Fixed** (7bba9efdd1), re-walked |
| Reviews showed no amounts | #4224 | **Fixed** (5560c1abf4): Cancel "Saved so far", Complete "Moves to your wallet". A full saved/interest split needs the server to expose the principal (follow-up) |
| Empty fifth PIN box after four digits | #4224 | **Fixed** (5560c1abf4) |
| Savings notice edge to edge on the wallet | #4224 | **Fixed** (af0b741459) |
| Completed plan card after Complete shows ₦0 / target and "Start with your first contribution" | #4223 session | Sent |
| No savings movements in any wallet history | — | Follow-up (no list exists yet) |
| Cancel was rejected locally | — | Local build drift (missing #4222's latest); fixed by updating the local build |

## Final verification walk (2026-11-13, mock PiggyVest)

All six checks passed on the simulator against the latest #4216, #4222, #4223
and #4224:
- A pending contribution settles by itself in about 15 s.
- Cancel shows "In this goal ₦2,000" and refunds the saved amount.
- Complete shows "In this goal ₦250,000" and moves it.
- The completed-plan card reads "Purchase requested" (#4223 821ec60a17).
- The "Copied" label doesn't shift the card (#4216).
- The wallet notice is inset like the cards.

The one new medium finding, a stale "Savings updated" notice outliving its
plan, is fixed in #4224.

Still owed outside this build:
- The same money steps on live PiggyVest staging, once outbound transfers
  resume.
- The exact interest split on the reviews, which needs the server to
  expose each goal's saved principal (#4222 follow-up).

## Status audit (2026-11-13, later)

The table above was re-checked against the pushed branches. Fund screens and
the airtime/data/power payment are being built by their owning sessions; the
"To review" rows (notifications, checkout rows, transactions) get a Fable walk
on the combined build. A Fable check of the cancel review breakdown
("Split check plan", no interest) passed: "Saved ₦50,000", "Back to your
wallet ₦50,000"; the forfeit line correctly stays hidden with no interest.

## Walk findings and fixes (2026-11-13, afternoon)

| Finding | Owner | Status |
| --- | --- | --- |
| Savings notification inbox rows had no card (style function dropped) | #4224 | **Fixed** 041fa26e2c, checked on simulator |
| Unlabelled "₦100 a month" in Add to savings | #4223 | **Fixed** 3b5838c558 ("Your plan: ₦100 a month, …"), checked on simulator |
| WalletContent / savings sheet over 300 lines once #4223 + #4224 combine | #4224 | **Fixed** 9e5ded499d (288 / 269 alone; 295 / 275 combined) |
| Savings wallet has no transaction history ("Store credit activity" only) | #4230 | List retitled "Older store credit" with an honest scope line; real PiggyVest activity needs a server read (new migration + route), not built |
| Checkout wallet rows not walked: shipping rates fail in the local stack | owner | Walk on staging, or allow local rate mocking |
| #4227 conflicts with #4222 in the savings/evidence executors | pay-from-wallet session | Sent; reconcile by merging #4222 |
| Storefront UI issues outside PiggyVest (blank toast, city error, Redeem contrast, home overlap, empty cart, settings footer) | proposed session | Awaiting owner start |

