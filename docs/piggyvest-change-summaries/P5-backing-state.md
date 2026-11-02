# P5-backing-state: wallet backing state

## What changes

Each Ogabassey customer wallet gets a recorded "backing state":

- **Legacy**: old-style Ogabassey wallet money. Every wallet starts here.
- **Migrating**: the wallet is locked while its checked old balance moves to the customer's PiggyVest wallet.
- **Backed**: the wallet holds only PiggyVest money.

The database gets these states, a history log, and three steps: start a move, finish it, and mark a wallet for review. The app gets one safe way to ask "what state is my wallet in?".

## Why

Each wallet holds one kind of money, so old and PiggyVest money can never be mixed or spent twice. Later changes use these states to route payments.

## What could go wrong and how it is prevented

- **A wallet going backwards**: always refused, even for the most privileged ordinary account. History can't be edited or deleted.
- **Backed without the money arriving**: only a zero balance or a PiggyVest-confirmed move makes a wallet backed. Only the future transfer engine can finish a move.
- **Money sent to the wrong place**: a move starts only if the customer finished PiggyVest setup, the store's PiggyVest connection is on, and the customer record still belongs to this store and to the person who set up PiggyVest.
- **The wrong amount**: the checked amount must equal the balance with no old payment pending, and is checked again at the finish; anything different stays locked for review. Balances too large for one history line (about 100 million naira) never start.
- **Money counted twice**: finishing writes one "moved out" and one "moved in" line for the same amount, balance unchanged. A repeat writes nothing.
- **A finished transfer undone**: finishing reports a refusal or review instead of failing, even if the customer record changed. A failing follow-up step leaves the move standing, marked for review.
- **A customer deleted mid-move**: blocked while migrating, so the move can finish. Trade-off: a wallet stuck in review blocks deletion until a later change can resolve it.
- **Customers seeing each other's state**: the app check answers only for the signed-in customer. Any error, including a record under another store, answers "unknown", meaning "stop".

## How it is tested

Database tests cover every refusal, the largest allowed amount, zero balances, a full move, repeats, changes mid-move, a failing follow-up step, deletion mid-move, every attempt to go backwards, and which accounts may run each step. App tests check every reply, errors, and that no privileged connection is used.

## How it stays switched off

- Nothing records any wallet state yet, so every wallet stays legacy.
- No login can start or finish a move.
- The follow-up steps do nothing.
- The "begin moves after setup" switch reports not ready.
- No screen uses the new check yet.
