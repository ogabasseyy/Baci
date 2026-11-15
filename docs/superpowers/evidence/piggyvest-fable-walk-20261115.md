# PiggyVest final walk (Fable, 2026-11-15)

## What was walked

- **Build:** local-only branch `e2e/piggyvest-final-20261115` in `/Users/mac/Baci-worktrees/pv-fund-spend`, never pushed. It is origin/main (with #4218) plus the open heads:
  - #4220 `286459fa93`
  - #4225 `036e28e54e`
  - #4227 `3d9dec7b31`
  - #4234 `1641978b55`
- **Simulator:** `pvb-sandbox-e2e`.
- **Account:** the fresh sandbox QA account `pvb-mock-money-1114235422`, on the local mock PiggyVest.
- **Local-only switches:** `SAVINGS_WALLET_CAN_PAY` and `SAVINGS_WALLET_CAN_PAY_UTILITIES` were flipped to `true` (uncommitted) so the wallet-pay screens show. Both stay `false` on every branch.
- **Live Petrock (owner-approved):** one live Petrock SIM Lock order was placed with the production token. The owner put the token into a local owner-only env file.

Screenshots are local only: `/private/tmp/claude-501/-Users-mac-Baci-app/a6191195-cff6-4d98-bd71-385f0a16582a/scratchpad/walk/NN-*.jpg`.

## Findings, by severity

| # | Severity | Screen | Finding | Steps | Shot | Owner |
|---|---|---|---|---|---|---|
| H1 | High | IMEI, live Petrock check | Live `POST /order` reply did not match `petrockSubmitOrderResponseSchema` (no `data[0][0].order_uuid`). The lookup went to `submission_unknown`: ₦500 held, the app says "We're checking" forever, and it can't recover by itself (no lookup by `reference_id`, and the callback can't reach a local server). If production gets the same reply shape, every Petrock-routed check (`simLock`, `esimCompatibility`, `applePartNumber`) gets stuck the same way. | Store credit ₦500 → SIM Lock → IMEI 356938035643817 → Verify Now | 64, 66, 72 | IMEI/Petrock (main). Check the production `imei_lookups` Petrock statuses and the Petrock dashboard; lookup `c0e7f0c9-9741-4a73-a910-7ee882b812f3` |
| H2 | High | IMEI, pay from wallet | A wallet-pay purchase key kept after a failed start traps that IMEI + check. Every later attempt goes back through the wallet sheet and shows "Can't check this payment right now", even when store credit covers the price. There is no way to pay. | Wallet pay on → SIM Lock → Pay → 503 (Petrock config) → retry → 409 refusal, and every retry after it | 57, 58, 64 | #4225 (`use-imei-wallet-pay`, kept-key replay) |
| M1 | Medium | IMEI, pay from wallet | The savings wallet is offered for Petrock-routed checks, but the server only lets the wallet pay for Sickw checks (`PIGGYVEST_PAY_UNAVAILABLE_FOR_TIER`). The refusal comes after Pay and the PIN. The app should know the payable checks up front, for example from the capabilities endpoint. | Wallet pay on → SIM Lock → "Pay ₦500 for SIM Lock" | 43, 44 | #4220/#4225 |
| M2 | Medium | Petrock catalogue cron | The remediation sync fails on every run: product 658 has `cost_usd 0.0000`, which breaks `petrock_remediation_products_cost_usd_check`, so `/api/cron/sync-petrock-catalog` answers 500. The product list itself synced (975 rows). | Run the cron with Petrock configured | log | IMEI remediation (main) |
| M3 | Medium | Wallet, "Older store credit" | A held IMEI charge (check not finished) shows as a plain "IMEI check −₦500" with no pending mark. | After H1 | 72 | wallet history labels |
| L1 | Low | Check your plan | "Yours in about 15188 days": should read in years and months, with a thousands separator, matching the "500 monthly contributions" line. | Start Savings, ₦500 monthly, ₦250,000 phone | 13 | Start Savings (main) |
| L2 | Low | Start Savings step 3 + cancel review | Interest warnings show on a savings-only plan: "Cancel early and lose your interest" and "Any interest earned isn't refunded". | Pick "No, savings only" | 12, 25 | Start Savings / cancel step |
| L3 | Low | Cancel review + "Goal cancelled" | "main wallet" where the card says "Savings wallet". | Cancel goal | 25, 28 | cancel step copy |
| L4 | Low | Savings sheet | The "Savings updated" notice stays pinned above Change phone and its review step. | Add ₦200 → Change | 22, 23 | savings sheet |
| L5 | Low | Add to savings | The amount pre-fills Max (the whole balance) on open and again after a phone switch. | Open the sheet | 15, 24 | savings sheet (decision) |
| L6 | Low | Start Savings | No nudge when a plan runs about 42 years (₦500 a month for ₦250,000). | Step 2 | 10 | product decision |
| L7 | Low | Change phone review | No back arrow, only the "Keep …" link. | Change → pick a phone | 23 | savings sheet |
| L8 | Low | Airtime | The single payment method isn't preselected. | Airtime | 46 | utilities form |
| D1 | Design | IMEI checker page | "Other options" toggles look like plain text and repeat under each section; the title stays "IMEI Results" after Back; "Out Of Warranty" is shown in green. | IMEI checker | 37–42, 35 | Handed to the IMEI redesign session (builds on #3874) |
| D2 | Design | PIN sheets | IMEI and airtime PIN sheets use a close X; the savings PIN sheet uses a back arrow and a subtitle. | — | 34, 19 | known open sheet-style decision |

## Passed

- **Wallet card:** balance, "Copied" feedback, and deposits net of fee ("₦50 fee deducted", +₦4,950).
- **Provider names:** none in customer text. The "Powered by PiggyVest" badge is the allowed wallet brand (owner, 11-13). "FAAS (SANDBOX)" is the sandbox bank's name.
- **Add money sheet:** the fee is explained.
- **Start Savings:** pick phone, rhythm, amount, the agreement-box error, Check your plan, create, plan ready.
- **Add to savings:**
  - typed ₦200;
  - an over-balance amount switches the button to "Add money";
  - the PIN sheet names the action;
  - "Savings updated";
  - balances: ₦950 → ₦750, In goals ₦200.
- **Change phone:** pace maths (₦700/month keeps the 2068 date), "Phone changed", savings carried over.
- **Cancel:**
  - review shows ₦200 → ₦200;
  - wrong PIN gives "That PIN is not right.";
  - right PIN gives "Goal cancelled", ₦200 back, and matching activity rows.
- **IMEI from the wallet (Sickw stub):** ₦300 Quick ID paid, report shown, balance ₦5,900 → ₦5,600, activity row "IMEI check −₦300".
- **IMEI fallback:** after the per-check refusal, the form falls back to store credit.
- **Airtime:** wallet offered with its balance, MTN detected, and a neutral "We couldn't start this purchase… Nothing was taken" when the start fails locally.
- **Settings → Wallet PIN:** renders with "Forgot your PIN?". Change and reset passed on walks 9–19, and the stack doesn't touch them.
- **Savings notifications:** toggles save (PATCH 200), 24-hour quiet hours, time zone, inbox.
- **Older store credit:** listed under the wallet activity, with no provider names.

## Not walkable here (owed on staging)

- Airtime, data and bills past the start call (`calculate_vtu` and the Monnify catalogue are staging-only).
- The two-way ₦1 staging transfer test, which waits for PiggyVest staging to settle transfers.
