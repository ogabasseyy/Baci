# Add-to-savings funding boundary

The hosted staging sheet now retrieves the current plan's PiggyVest bank account
on open. A manual plan no longer needs an amount or an ordinary-wallet balance
before its account number, copy action and bank are visible. Lookup is read-only
and scoped to the signed-in user, merchant and goal; closing the sheet unmounts
it. No account creation or funding request runs on open.

The card section is deliberately unavailable, with an explicit explanation.
It is not a working card-payment integration or an end-to-end completion claim.
An auto-debit plan previews the extra-contribution amount form without mutating
its schedule. Adding a card must never change a manual plan's source mode.

## Missing connection

The current Paystack authorization and scheduled-charge implementations credit
the Baci internal wallet and allocate from it. They do not move the money to the
PiggyVest plan. The hosted staging test-payments service likewise settles only
the internal test wallet. Do not wire either endpoint to a button labelled as
funding the PiggyVest plan.

On 26 September 2026 the owner chose verified card collection followed by a
transfer from a prefunded PiggyVest business wallet to the mapped plan wallet.
Paystack split settlement and a Paystack outbound transfer are not the selected
funding model. Later settlement replenishment is a separate business operation.
The written design is in
`docs/superpowers/specs/2026-09-26-prefunded-piggyvest-card-savings-design.md`.
This records the decision; the card bridge is not implemented or enabled yet.

PiggyVest's [wallet transfer contract](https://www.piggyvestbusiness.com/docs/api/transfers/wallet)
requires a funded source wallet and treats 202 as processing, not final success.
The prefunded source must be a verified business-owned wallet, not a customer's
plan wallet or an assumed old probe balance. No actual prefunding amount or
live transfer has been authorized by this design choice.

## Before enabling the card controls

Implement an authenticated, merchant/customer/goal-scoped one-off contribution
intent with a durable idempotency key; preserve the recurring schedule. Use the
customer's scoped saved-card reference, never a client-supplied authorization.
Verify the collection server-side, reserve the chosen transfer once, reconcile
uncertain outcomes, and credit savings only on confirmed provider receipt.
Prevent the collection and receipt from both crediting the same contribution.

Expose the real capability and saved-card list, including loading/error states,
then wire Add a card and Charge card. Retain manual bank transfer after card
addition. Cover success, cancellation, declined cards, unknown settlement,
duplicates, concurrent requests, tenant isolation and unchanged schedule.
Prove the chosen rail with provider sandbox receipts before claiming phone E2E.

This UI change leaves non-hosted production payment paths, staging allowlists,
backend services, provider balances and saved payment methods unchanged.

## Local verification (25 September 2026)

- Regression first: three new modal tests failed against the old flow (account
  hidden behind amount/wallet funding and auto-debit contribution form absent).
- After change: four new suites, 25 tests passed. Eight touched TypeScript files
  passed Biome; the changed modal remains under 300 lines.
- Metro on port 8082 was verified to serve this worktree. Its iOS bundle returned
  HTTP 200 and contained the new account-first and unavailable-card views.
  The physical phone was not inspected in this turn.
- Adjacent suites: 49 passed, two legacy modal assertions still expect old wallet
  funding labels/copy. The legacy contribution component was not changed.
- Root lint and typecheck were attempted and failed on existing issues outside
  these changes (including the date-format tuple test and missing idempotency
  fixture fields). The full monorepo test run was stopped after unrelated
  failures; it is not a passing full-suite claim.
- Luna reviewed the new mobile scope without finding a concrete regression.
  CodeRabbit refused the uncommitted review with `too_many_files` (198 vs 150).
  A narrower review is still needed; no CodeRabbit pass is claimed.
