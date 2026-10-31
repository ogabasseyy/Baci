# P5-engine-schema: the transfer engine's foundations

## What changes

The database foundations for moving money between PiggyVest wallets. Nothing moves money yet.

- **Ogabassey's own wallets.** A register for the Collection, Interest and Fee wallets. A customer's wallet can never be registered there, and a checked wallet's details are locked.
- **Allowed movements.** Twelve fixed kinds of transfer, each with a set start and end (an airtime payment goes from the customer to Collection). Any other route is refused.
- **Transfers and attempts.** One record per movement. Each try at PiggyVest gets its own reference, never reused, and a new try is allowed only after the last one is proven to have failed.
- **Spending holds** that pause a customer's spending while something is checked.
- **One door for balance changes.** The spendable balance changes in one place only, once per change, with a record of who asked and who applied it.
- **Empty settle and fail steps** for later changes. An automatic check lets only each step's named owner fill it in.
- **A small reader** for Ogabassey's wallets.

## Why

Every movement will go through one engine. Fixing its tables and rules first stops later changes quietly altering how money moves.

## What could go wrong and how it is prevented

- **Paying back more than was taken.** Refunds and releases are capped at the amount first taken. Anything above goes to review and the balance is not touched.
- **A change applied twice.** A repeat is recognised and nothing new is written, even with two sessions at once.
- **Old balances counted twice.** Moving an old balance never adds to the customer's balance, because that money is already in it.
- **The app or support changing balances.** Only a dedicated login, not created yet, may change a balance. Requests from the app's logins are only recorded, and payments that must take money at once are refused.
- **Lost history.** Deleting an account keeps settled records and is refused while money is still moving.
- **Public access.** Nothing can be reached with the app's public, customer or admin keys.

## How it is tested

Database tests on real PostgreSQL cover every allowed and refused route, the locks, the refund cap, the once-only rule, two sessions at once, account deletion and permissions. Other tests cover the reader and the ownership check. Each safety rule was broken on purpose to prove a test catches it.

## How it stays switched off

Every table starts empty. Only the owner adds Ogabassey's wallets, following a written guide. The engine logins do not exist yet, so nothing can be applied, and the interest sweep refuses until it is built.
