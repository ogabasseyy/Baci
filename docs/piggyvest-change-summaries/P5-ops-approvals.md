# Two-person approvals for PiggyVest money operations

Task: P5-ops-approvals
Owner sign-off: required

## What changes

This adds one shared approval process for sensitive PiggyVest operations staff run by hand, such as moving Collection money to the Ogabassey bank account. A request records exactly what will happen: the action, the record and its current version, the amount and where the money goes. It can only be carried out after two different people approve it, and neither can be the person who asked. Each approver signs in with their own database login and uses a small command-line tool to approve or reject.

## Why

Your default 8 asks for two-person approval before money leaves Collection, and later steps (support payouts, stuck-transfer reviews, misrouted interest) need the same protection. Building it once gives every later feature the same tested rules.

## What could go wrong and how it is prevented

- One person approving twice, or approving their own request: the database records who is actually signed in, never a typed-in name, and refuses both.
- An approval reused for something else: each approval is tied to the exact action, record version, amount and destination. If any of these change, the approvals no longer count.
- Old approvals lingering: requests expire after 24 hours and work only once. Any single rejection closes the request.
- A system account posing as an approver: an approver login must hold the approver permission and nothing else. If it is later given an engine, support or service permission, its approvals stop counting.
- Approving the wrong amount: the tool shows the naira amount and a masked destination, and the approver must retype the amount first.
- Passwords leaking: the tool asks for the password at a hidden prompt only, never from the command line or the environment. You create approver logins by hand, never code or an AI agent.

## How it is tested

Database tests sign in as four separate test logins to prove each rule: one approval, the same person twice and the requester are refused; two real approvals work exactly once; changed amounts, versions or destinations, expired requests and rejections are refused; a sneaked-in approver name is ignored. Permission checks confirm the app, customers and the service account cannot reach it. Tool tests prove it is a dry run by default, aborts on a mistyped amount and never reads a password from the environment or command line.

## How it stays switched off

Nothing in the app uses these approvals yet and no approver logins exist. It stays inactive until later features call it and you create two approver logins yourself, following the approvals runbook.
