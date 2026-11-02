# A secure record of PiggyVest freezes and liens on customer wallets

Task: P3-wallet-restrictions-store
Owner sign-off: not required

## What changes

PiggyVest can freeze a wallet, or put a lien on part of its money, and tells us when a restriction is placed or lifted. This adds a secure record of restrictions on customers' main wallets, a history of PiggyVest's messages about them, and one question other parts can ask: "is this wallet restricted now?" Nothing writes to it yet.

## Why

A frozen or liened wallet must not spend or transfer (money rules R1 and R2). Until now a main-wallet restriction had nowhere to be recorded, so payment checks could not see it.

## What could go wrong and how it is prevented

- An unfamiliar restriction could be ignored. Anything not clearly a freeze or a lien is stored as "unknown" and still blocks, as does a restriction without PiggyVest's restriction number, until reviewed.
- A message could arrive twice. Each message counts once, by its PiggyVest message number, and every accepted number is remembered for good, even after a newer lift replaces an older one. A reused number with different details is a conflict and changes nothing, so it can be reviewed.
- The lift could arrive before the restriction. The lift is kept, so the late restriction arrives lifted; PiggyVest's times decide the order.
- A lift could clear the wrong thing. A lift clears only the restriction it names, on the wallet it names.
- The wrong login, or a switched-off connection, could lift a freeze. Every write names our PiggyVest connection and its environment, and is refused unless that connection and its evidence login are switched on and the caller is that login. A restriction belongs to the connection that recorded it, but any restriction blocks the wallet.
- Someone could read or change the record. Customer logins, app logins and the general admin key cannot reach it. Only the dedicated evidence login can record restrictions, and only it and the dedicated payment-check login can ask whether a wallet is restricted.

## How it is tested

Database tests prove that a restriction blocks until lifted; repeats are ignored; conflicts, including reused numbers of older or replaced lifts, change nothing; early and back-dated lifts follow PiggyVest's times; unknown restrictions block; and the wrong login, connection or environment, or bad input, is refused with nothing stored. A permissions test fails if anyone except the two dedicated logins can reach the record or its history.

## How it stays switched off

Nothing writes to the record yet. The webhook step that fills it is a later change, PiggyVest webhooks are still answered "not ready" in production, and the dedicated evidence login is not yet set up there.
