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
| Fund | Add money sheet + transfer instructions | `WalletFundModal`, `WalletFundPanel` | Built in #4230 (no alerts); Fable-walked 11-13: pass; low fixes done in 00c334bab7 (PiggyVest merchant only) |
| Fund | PiggyVest onboarding (BVN, consent, pending) | `PiggyvestWalletSetupPanel`, `PrimaryWalletSetupPending` | Built in #4230; walk owed with a fresh account (onboarding only shows before setup) |
| Fund | Credit arrives ("Money received") | `use-primary-wallet-credit-poll` | Built in #4230; checked on the mock 11-13: inline "Money received" notice, balance updated |
| Fund | Wallet activity under the card | `activity/PiggyvestWalletActivity`, `list_piggyvest_wallet_activity` | Built in #4232 (stacked on #4230): deposits, contributions, goal refunds and completions. **Owed:** IMEI/VTU spends from the wallet are not recorded anywhere yet (pay-from-wallet #4225/#4227 must record them before they can be listed) |
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

## Status (2026-11-13, evening)

PiggyVest is enabled for the Ogabassey merchant only (owner, 11-13). Holds and PiggyVest UI are scoped to it.

| Item | Where | Status |
| --- | --- | --- |
| Fund screens (Add money, onboarding, Money received) | #4230 | Built; walked; low findings with the fund session |
| PiggyVest wallet activity list | #4232 | Built; Fable-walked: rows, labels, AI-button inset, Show more (cursor fix a41e1a35a3) pass |
| Airtime/data/bills from the wallet | #4227 | Built; wallet offered and shortfall shown (walked). Pay → PIN not reachable locally (no Monnify catalogue / no real MTN number); **owed on staging** |
| Checkout payment step | walked 11-13 | No wallet row, by design (wallet pays IMEI and VTU only); storefront findings in #4229 |
| #4216 holds | #4216 | Being scoped to Ogabassey only |
| Data/bills catalogues, live money steps | staging | Owed: no Monnify catalogue locally; PiggyVest outbound transfers paused |

## Walks (2026-11-13, late)

- Fund screens (#4230): no iOS alerts anywhere; "Money received" appears inline while Add money is open. Low fixes are done.
- Wallet activity (#4232): passes. The test account has 20 rows, so page 2 is covered by paging tests.
- IMEI wallet chip (#4225): shows "Savings ₦551,600". IMEI checks have no catalogue locally, so the pay sheet is owed on staging.
- Airtime (#4227): the savings wallet is offered and the over-balance shortfall is shown. Pay stops before the PIN locally, because the biller lookup needs Monnify; **owed on staging**.
- Provider names: customer wallet history and billers errors no longer show providers (#4233; owner, 11-13).

### Still owed (not runnable locally)
- On staging, once PiggyVest resumes outbound transfers: airtime/data/bills and IMEI pay to the PIN and settlement, and the money steps end to end.
- Owner actions: the `allow-silent-revert` label on #4224; marking #4223 ready.


## Walk 4: refreshed combined build (2026-11-13, 19:30–20:07, Fable, mock PiggyVest)

Build: every open PiggyVest head merged locally (#4216, #4222, #4223, #4224, #4230, #4232, #4233, #4234 stack).

Pass:
- onboarding (BVN, consent, ready) with a fresh account;
- Add money;
- Start Savings / Check your plan;
- Add to savings + PIN;
- in-sheet Cancel and Complete;
- Change phone;
- Wallet PIN (no chat button);
- old goal-actions link;
- wallet activity (no provider names in any of 26 API rows or on screen).

| Finding | Owner | Status |
| --- | --- | --- |
| F1 dead Complete button on a settled plan | #4224 | **Fixed** 15f79481ac |
| F2 cancelled-plan notification opened another plan | #4224 | **Fixed** 15f79481ac (taps go through the goal link route) |
| F3 activity rows gross, balance net (deposit fee hidden) | #4232 | **Fixed** 3dfaa869bb (net amount + fee line; Add money mentions the fee) |
| F4 Change phone quoted weekly on a monthly plan | #4224 | **Fixed** 15f79481ac |
| F5 savings sheet stayed over another screen | #4224 | **Fixed** 15f79481ac (closes on blur) |
| F6 goal link trusted a stale wallet | #4224 | **Fixed** 15f79481ac, 6193b93895 (one fresh read per goal; a failed read keeps the link) |
| F7 airtime 500 blamed PiggyVest / connection | #4225 | **Fixed** da1f56cec0 (neutral copy, savings wallet, title once) |
| Notification card offset, 3-line cut, AI button overlap, raw time zone | #4224 | **Fixed** 15f79481ac (time zone gets a hint, picker deferred) |
| "Move your savings" vs "Complete goal" | #4224 | **Fixed** 15f79481ac |
| Start Savings lows (debit time, terms error, amount focus, search caps, picker tint) | #4223 | **Fixed** 54f8a88a46 |
| Onboarding lows (consent error, disabled button, BVN show/hide, naming) and older store credit / Money received placement | #4230 | **Fixed** 6f611b14c8 |
| PIN context rows lack goal name; no "phone changed" confirmation | #4224 | **Fixed** d9058f62ce |
| Sheet style differences (grey vs red handles, arrow vs chevron back) | design | Open (low): needs one shared sheet/back-button decision across PRs |

Not walkable locally:
- onboarding pending (the mock answers ready at once);
- the cancel forfeit line (needs an interest-payout webhook);
- IMEI and airtime Pay → PIN.

These, and the staging transfer test both ways (business → customer, customer → business), are owed on staging. A ₦1 probe at 17:49 UTC got 202 but never settled.

## Walks 5 and 6: fixes confirmed on the simulator (2026-11-13, mock PiggyVest)

Walk 5 (all heads merged) confirmed:
- F3: net rows plus a fee line, and Add money mentions the fee.
- F7: neutral airtime error.
- The Start Savings fixes, the onboarding fixes, and notifications.
- No "Older store credit" section for a new customer; "Money received" shows inside the sheet.

It also found a blocker: the savings sheet never opened (close-on-blur via useFocusEffect). That is fixed in 16891aa374 (navigation blur/focus events).

Walk 6, on that fix, passed all seven items:
- the sheet opens;
- F4 monthly pace and "Phone changed";
- F5 sheet closes on leaving and reopens fresh;
- F6 goal created outside the app;
- PIN line "Cancelling <goal>";
- "Complete goal" card label (#4223 e42be94e1a);
- F1 settled plan notice and cancelled plan notice.

Walk 5/6 lows:

| Finding | Owner | Status |
| --- | --- | --- |
| Settled plan sheet showed "₦0 of ₦250,000" with no context | #4224 | **Fixed** 2ee4afd868 ("Purchase requested…") |
| Change phone pace read as a quote (₦25,018) while the plan line stays ₦100/month | #4224 | **Fixed** 2ee4afd868 ("Suggested to finish by", rounded to ₦100) |
| BVN field red border at rest | #4230 | **Fixed** a7aa48eaf2 |
| Activity amount touching the fee line | #4232 | **Fixed** 21e0fdddfc |
| Sign-in placeholder letter-spaced after code sign-in | #4229 | Sent |
| Airtime phone field over 11 digits; IMEI arrow back button | #4227 / #4225 | Queued (waits on the owner's "Finish and push" in that session) |
| #4216 vs #4223 head-start rail conflict | #4216 session | Sent (reconcile so either can merge first) |
| Change phone replaces a custom goal title with the phone name | owner | Decision |

## Walks 7 and 8 (2026-11-13, mock PiggyVest)

Walk 8 ran on every open head except #4229 and the pay-from-wallet stack's latest round, and included #4216 for the first time. All seven walked items pass:
- Change phone pace wraps and shows the full amount.
- BVN border: neutral at rest, ink when focused.
- The savings sheet opens, stays open, closes on leaving, and reopens on the first step.
- The cancel PIN line names the goal.
- A settled plan shows "Purchase requested".
- A new Start Savings plan is created once and reaches enrolled, with no duplicate.
- Wallet hero and activity show no provider names.

| Finding | Owner | Status |
| --- | --- | --- |
| Change phone pace line clipped | #4224 | **Fixed** b85799ac78; walk 8 pass |
| BVN focus border looked like an error | #4230 | **Fixed** d1abc10183; walk 8 pass |
| Reopened savings sheet kept the picked amount | #4224 | **Fixed** 99d9243e72 |
| "About 9 months" next to "10 monthly contributions" | #4223 | Sent |
| Sign-in placeholder letter-spacing | #4229 | Fixed 32ddbb724c; not yet walked |
| Airtime >11 digits, IMEI arrow | pay-from-wallet stack | Waits on the owner's "Finish and push" |

Still owed: the live staging transfer test in both directions (business → customer, customer → business). Staging accepts a ₦1 transfer (202) but does not settle it.

## Walks 9–16 (2026-11-14, mock PiggyVest)

Each walk ran on a local-only combined build (`e2e/piggyvest-all`, never pushed) with the latest heads of #4224, #4216, #4222, #4223 and the pay-from-wallet stack (#4218, #4220, #4225, #4227, #4234). Each walk's findings went to the PR that owns them, and the next walk rechecked them.

| Walk | Build | What it covered | Outcome |
|---|---|---|---|
| 9–10 | 1144822608, d3644d78df | All savings screens on the combined build | A completed goal swapped to another goal, the PIN sheet could be dragged shut mid-check, the closed-plan note leaked into the next goal's sheet, and an offline hero showed the goals total. All fixed. |
| 11 | 7f849374b9 | Walk-10 fixes | All 5 fixed. New: an update loop on a settled goal (high), settled-goal links, a hung link read, a red info note, a ₦0 flash. Fixed in 630598739e and ce6e0410d2. |
| 12 | e8aba60ae5 | Walk-11 fixes and #4216's offline fixes | All fixed except the closed note surviving Back. Fixed in f2dc88ed04. |
| 13 | 0127982eb0 | Back, in-flight notice, sheet scroll, close X | The Back fix did not fire (expo-router has no `beforeRemove`), and an "awaiting confirmation" card flashed on every add. Fixed in 60699bbbf9 and 20859f664d. The close X miss is only the dev-menu button covering it. |
| 14 | e05b7c097f | Final full walk, including pay-from-wallet | IMEI paid from the wallet end to end, plus wrong PIN, refund on provider failure and no provider names. Found: the orders link behind the AI button, transport error text, the PIN hint not clearing, the last-known account number on cold launch, and four pay-from-wallet items. All fixed: #4224 in c521a3c9a1, #4216 in a88e7e9625, the stack in its next heads. |
| 15 | 6ebaada040 | Walk-14 fixes | 11 of 13 pass. #4224's "try again" beside the pending card and stale goal options were fixed in 3114b5b63c. #4216's warm hint and three IMEI/airtime items were fixed by their sessions. |
| 16 | 4183832ee7 | Walk-15 fixes | 6 of 7 pass, and all regressions pass. |

### Left open after walk 16 (all low)
- The fresh IMEI form shows "Pay ₦1,000 for Full Report", dimmed until an IMEI is typed, with the preselected card below the fold. #4225 chose to name the check rather than preselect nothing.
- The first Add tap right after the sheet recovers from an outage can meet "Checking contributions… Please try again after this check." This is the safety check for an earlier transfer still finishing; a second tap works.
- The savings PIN sheet says "That PIN is not right." without a tries-left count. The IMEI and airtime sheets show one, but the savings PIN API doesn't return it.
- With the server down at cold launch, the plan sheet's status note says "Getting your plan ready" for a ready plan. Sent to #4223.

### Still owed
- Airtime from the wallet past the start call: the local stack doesn't serve `calculate_vtu`, so this is staging-only.
- The staging transfer test, business → customer and customer → business, waits for PiggyVest staging to settle transfers. A ₦1 probe on 2026-11-13 was accepted (202) but never settled.
