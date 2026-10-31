# P5-backing-state: wallet backing state

## What changes

Each Ogabassey customer wallet gets a recorded "backing state" with three steps:

- **Legacy**: old-style Ogabassey wallet money. Every wallet starts here.
- **Migrating**: the wallet is locked while its checked old balance moves into the customer's PiggyVest wallet.
- **Backed**: the wallet holds only PiggyVest money.

The database gets these states, a history log, and three steps: start a move, finish a move, and mark a wallet for review. The app gets one safe way to ask "what state is my wallet in?".

## Why

The plan keeps each wallet to one kind of money, so old money and PiggyVest money can never be mixed or spent twice. Later changes use these states to route payments and block old payment paths.

## What could go wrong and how it is prevented

- **A wallet going backwards**: the database always refuses, even for its most privileged ordinary account. History can't be edited or deleted.
- **Marking a wallet backed when the money never arrived**: a wallet becomes backed only when its checked balance was zero, or when PiggyVest confirmed the move transfer. No person or app account can run "finish a move"; only the future transfer engine can, after confirming the transfer.
- **Moving the wrong amount**: a move starts only if the customer finished PiggyVest setup, belongs to this store, has no old payment pending, and the checked amount equals the balance at that moment. The balance is checked again when the move finishes; if it changed, the wallet stays locked and goes to review.
- **Money counted twice**: finishing a move writes one "moved out" line and one "moved in" line for the same amount, and the balance doesn't change. Running it again writes nothing.
- **A later follow-up step failing**: the move still stands and the wallet is marked for review.
- **Customers seeing each other's state**: the app check answers only for the signed-in customer. If it fails, the app gets "unknown", which must be treated as "stop".

## How it is tested

Database tests cover every refusal, zero balances, a full move, running each step twice, a balance changing mid-move, a failing follow-up step, every attempt to go backwards, and exactly which accounts may run each step. App tests check every reply, errors, and that no privileged database connection is used.

## How it stays switched off

- Nothing records any wallet state yet, so every wallet stays legacy.
- No login can start or finish a move.
- The follow-up steps do nothing.
- The "begin moves after setup" switch reports not ready.
- No screen uses the new check yet.
