# S5m: Wallet PIN in the storefront app

## What changes
The storefront app can now ask a customer to set a wallet PIN and to type it before money moves from their main wallet into a savings goal. A small sheet handles three cases: set a PIN (enter it twice), reset a PIN when the server says a reset is needed, and enter the PIN to confirm a contribution. The old "wallet PIN is coming soon" message is gone. On the wallet screen, a contribution the server cancelled because the wallet was unavailable now releases its stored reference, as the start-savings screen already did.

## Why
The server already refuses a goal contribution that has no PIN proof. Until now the app had no way to supply one, so saving into a goal from the app could not finish.

## What could go wrong and how it is prevented
- The PIN is typed only into the sheet, sent only to the PIN check, and cleared as soon as it is used or the sheet closes. It is never stored, logged or sent elsewhere.
- The proof the server returns is tied to one goal, one contribution reference and one amount, and works once. The app retries only when the server clearly says a PIN was missing or refused, using the same reference and the same payment route, so a retry can never pay twice or switch routes. Any other failure is not retried.
- The sheet appears only after the server asks for a PIN. If the server says the PIN service is unavailable, or the answer is missing or unreadable, the customer sees "Wallet PIN is unavailable right now" and is never offered the set-a-PIN screen.
- Wrong-PIN and lockout messages come from the server, unchanged.
- Closing the sheet sends nothing, keeps the stored reference and route for the next attempt, and tells the customer: "Your goal was created. Add money to it from your wallet when you're ready."
- A PIN check that is still running when the sheet is closed and re-opened is ignored when it answers, so an old proof can never be used for a newer request.

## How it is tested
Automated tests with mocked network answers cover setting, resetting and entering a PIN, wrong-PIN and lockout copy, the unavailable cases, the retry with the proof on the same reference and route, a closed sheet, the proof never reaching the older payment route, and both contribution screens. Each new or changed file has a server-off test, and the release-gate check passes. No live sandbox was used.

## How it stays switched off
Nothing here runs unless the server has PiggyVest on and asks for a PIN. With PiggyVest off, the app behaves exactly as it does today: no sheet opens and no PIN call is made. The app reaches phones only through the owner's deliberate store release.
