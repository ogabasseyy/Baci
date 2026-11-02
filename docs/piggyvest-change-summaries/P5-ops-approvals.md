# Two-person approvals for PiggyVest money operations

Task: P5-ops-approvals
Owner sign-off: required

## What changes

One shared approval process for PiggyVest operations staff run by hand, such as moving Collection money to the Ogabassey bank account. A request records the action, the record and its version, the amount and where the money goes. It is carried out only after two different people approve it, neither of them the person who asked. Each approver uses their own database login and a small command-line tool.

## Why

Your default 8 asks for two-person approval before money leaves Collection. Later steps (support payouts, stuck transfers, misrouted interest) need the same, so one tested mechanism serves them all.

## What could go wrong and how it is prevented

- Approving twice, or your own request: the database records who is really signed in, never a typed-in name, and refuses both.
- "Who asked" meaning nothing: only a person's or a worker's own login can open a request. The admin account, the website's shared account and logins with extra powers are refused.
- An approval reused for something else: it is tied to the exact action, record version, amount and destination. Any change voids it.
- A rejection worked around: the same details cannot be asked for again. Only a real change can.
- Old approvals lingering: requests expire after 24 hours and work only once.
- A system account posing as an approver: approver logins hold the approver permission only, re-checked when money moves.
- A misleading destination: approvers see the bank code and last four digits first. Any name the requester adds comes after, in quotes, with no numbers.
- Session tampering: the approval functions use only the database's built-in definitions, so nothing an approver sets up changes them.
- Approving the wrong amount: the approver must retype the naira amount first.
- Passwords leaking: hidden prompt only. You create approver logins by hand, never code or an AI.

## How it is tested

Database tests sign in as five separate test logins and prove every rule above: refusals for one approval, the same person twice, the requester, changed details, expiry, rejection and asking again; exactly one use of two real approvals; shared and admin logins refused; session tampering harmless. Permission checks confirm the app, customers and the service account cannot reach it. Tool tests prove a dry run by default, a stop on a mistyped amount, and no password from the environment or command line.

## How it stays switched off

Nothing uses these approvals yet and no approver logins exist. It stays inactive until later features call it and you create two approver logins yourself (see the approvals runbook).
