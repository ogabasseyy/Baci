# Recording which kind of money a customer wallet holds

Task: P5-backing-state
Owner sign-off: required

## What changes

Each Ogabassey customer wallet gets a recorded "backing state":

- **Legacy**: old Ogabassey money. Every wallet starts here.
- **Migrating**: locked while its checked balance moves to the customer's PiggyVest wallet.
- **Backed**: the wallet holds only PiggyVest money.

The database gets these states, a history log, and three steps: start a move, finish it, and flag a wallet for review. The app gets one safe state check.

## Why

A wallet holds one kind of money, so old and PiggyVest money can't be mixed or spent twice.

## What could go wrong and how it is prevented

- **A wallet going backwards**: always refused; history can't be edited or deleted.
- **Backed without the money arriving**: only a zero balance or a PiggyVest-confirmed move makes a wallet backed, and only the future transfer engine can finish one.
- **Money sent to the wrong place**: a move starts only if setup is finished, the store's PiggyVest connection is on, and the customer still belongs to this store and the person who set up PiggyVest. Rechecked at the finish, including that the customer is still the same person.
- **The wrong amount**: the checked amount must equal the balance with no payment pending, and is rechecked at the finish; anything different stays locked for review.
- **Money counted twice**: finishing writes one "moved out" and one "moved in" line. A repeat writes nothing; a different move goes to review.
- **A finished transfer undone**: finishing reports a refusal or review instead of failing, even if a "moved" line already exists; nothing is half-written. A failing follow-up step leaves the move standing, flagged.
- **Follow-up steps skipped for zero balances**: a zero-balance wallet becomes backed without a transfer, so it runs the same follow-up steps as a finished move.
- **A customer deleted mid-move**: blocked while migrating, so a wallet stuck in review blocks deletion.
- **Customers seeing each other's state**: the check answers only for the signed-in customer.
- **Freezing payments during the release**: the duplicate-line rule is its own release step, built while payments carry on.

## How it is tested

Database tests cover every refusal, zero and largest balances, a full move, repeats, changes mid-move (including a changed person or an existing "moved" line), failing follow-up steps, deletion, every attempt to go backwards, and who may run each step. App tests check every reply.

## How it stays switched off

Nothing records any wallet state yet, so every wallet stays legacy. No login can finish a move, the follow-up steps do nothing, and no screen uses the new check.
