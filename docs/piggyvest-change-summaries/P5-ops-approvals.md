# Two-person approvals for PiggyVest money operations

Task: P5-ops-approvals
Owner sign-off: required

## What changes

One shared approval process for PiggyVest operations staff run by hand, such as moving Collection money to the Ogabassey bank account. A request records the action, the record and its version, the amount and where the money goes. It is carried out only after two different humans approve it, neither of them the human who asked. Each approver uses their own database login and a small command-line tool.

## What changed after review

- Logins are not humans. A person has an ops login to ask and an approver login to approve, and the names never match, so a name check would let one person do both. A small table, written only by you, now says which human each login belongs to, and every rule compares humans. Your own approver login cannot approve your request, and one human's two approver logins count once.
- A login missing from that table is refused everywhere, including when carrying out an action.
- A request that expires while a call waits in line is refused, and later records carry the time after the wait.
- A destination missing its account or bank code is refused instead of stored.
- The password prompt cancels cleanly if the terminal closes.

## What could go wrong and how it is prevented

- Approving twice, or your own request: refused by human, not by typed name.
- "Who asked" meaning nothing: only a registered person's or worker's own login can open a request. The admin account, shared accounts and logins with extra powers are refused.
- An approval reused for something else: it is tied to the exact action, record version, amount and destination. Any change voids it.
- A rejection worked around: the same details cannot be asked again.
- Old approvals lingering: requests expire after 24 hours and work once.
- A system account posing as an approver: approver logins hold that permission only, re-checked when money moves.
- Passwords leaking: hidden prompt only; you create logins by hand.

## How it is tested

Database tests sign in as separate test logins and prove each rule, including one human with two logins, an unregistered login, a renamed login and calls waiting in line while a request expires. They also fail against deliberately broken versions. Tool tests prove a dry run by default.

## How it stays switched off

Nothing uses these approvals yet and no logins are registered. It stays inactive until later features call it and you create and register two approver logins yourself (see the approvals runbook).
