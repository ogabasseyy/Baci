# Recording which kind of money a customer wallet holds

Task: P5-backing-state
Owner sign-off: required

## What changes

Each Ogabassey customer wallet gets a recorded "backing state":

- **Legacy**: old Ogabassey money. Every wallet starts here.
- **Migrating**: locked while its checked balance moves to the customer's PiggyVest wallet.
- **Backed**: the wallet holds only PiggyVest money.

The database gets these states, a history log, and three steps: start a move, finish it, and mark a wallet for review. The app gets one safe "what state is my wallet in?" check.

## Why

A wallet holds one kind of money, so old and PiggyVest money can't be mixed or spent twice.

## What could go wrong and how it is prevented

- **A wallet going backwards**: always refused, and history can't be edited or deleted. Marking a wallet backed by hand is refused too.
- **Backed without the money arriving**: only a zero balance or a PiggyVest-confirmed move makes a wallet backed, and only the future transfer engine can finish one.
- **Money sent to the wrong place**: a move starts only if setup is finished, the store's PiggyVest connection is on, and the customer still belongs to this store and the person who set up PiggyVest. Checked again at the finish.
- **The wrong amount**: the checked amount must equal the balance with no old payment pending, and is checked again at the finish; anything different stays locked for review.
- **Money counted twice**: finishing writes one "moved out" and one "moved in" line. A repeat of the same move writes nothing; a different confirmed move goes to review.
- **A finished transfer undone**: finishing reports a refusal or review instead of failing. A failing follow-up step leaves the move standing, flagged for review.
- **A customer deleted mid-move**: blocked while migrating. Trade-off: a wallet stuck in review blocks deletion until resolved.
- **Customers seeing each other's state**: the check answers only for the signed-in customer; any error means "unknown".
- **Freezing payments during the release**: the rule against duplicate "moved" lines is its own release step, built while payments carry on. If interrupted, the next release rebuilds it.

## How it is tested

Database tests cover every refusal, zero and largest balances, a full move, repeats, changes mid-move, a failing follow-up step, deletion, every attempt to go backwards, and who may run each step. They also confirm the duplicate-line rule is unique and finished. App tests check every reply.

## How it stays switched off

Nothing records any wallet state yet, so every wallet stays legacy. No login can start or finish a move, the follow-up steps do nothing, and no screen uses the new check.
