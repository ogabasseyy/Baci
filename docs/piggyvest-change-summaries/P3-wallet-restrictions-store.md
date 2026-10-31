# A secure record of PiggyVest freezes and liens on customer wallets

Task: P3-wallet-restrictions-store
Owner sign-off: not required

## What changes

PiggyVest can freeze a wallet, or put a lien on part of its money. It tells us when a restriction is placed and when it is lifted. This change adds a secure record of those restrictions for customers' main wallets, and one question the rest of the system can ask: "is this wallet restricted right now?" Nothing writes to the record yet.

## Why

The money rules say a frozen or liened wallet must not spend or transfer. Until now a restriction on a main wallet had nowhere to be recorded, so later payment checks could not see it.

## What could go wrong and how it is prevented

- An unfamiliar restriction could be ignored. Anything that is not clearly a freeze or a lien is stored as "unknown" and still blocks. A restriction without PiggyVest's restriction number also blocks until our team reviews it, because no lift could ever match it.
- A message could arrive twice. Each message counts once, by its PiggyVest message number. A repeat with different details is flagged as a conflict and changes nothing, so it can be reviewed.
- The lift could arrive before the restriction. The lift is kept, so the late restriction arrives already lifted. When PiggyVest gives times, its times decide the order, not the order messages reach us.
- A lift could clear the wrong thing. A lift clears only the restriction it names, on the wallet it names; any other restriction keeps blocking.
- Someone could read or change the record. Customer logins, app logins and the general admin key cannot reach it. Only the dedicated PiggyVest evidence login can record restrictions, and only it and the dedicated payment-check login can ask whether a wallet is restricted.

These protect money rules R1 and R2: a restricted wallet cannot spend.

## How it is tested

Automated database tests prove that a restriction blocks and its lift clears it; repeats are ignored and conflicts change nothing; an early lift leaves the restriction cleared; a lift dated before the restriction does not clear it, while a later one does; unknown restrictions block; a lift for one wallet never clears another; and bad input is refused. A second test reads the database's permission records and fails if anyone except the two dedicated logins can reach the record.

## How it stays switched off

Nothing writes to the record yet. The webhook step that fills it is a later change, PiggyVest webhooks are still answered "not ready" in production, and the dedicated evidence login is not yet set up there.
