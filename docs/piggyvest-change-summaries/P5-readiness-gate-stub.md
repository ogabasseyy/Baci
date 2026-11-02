# A safety check that stops PiggyVest deposits being credited too early

Task: P5-readiness-gate-stub
Owner sign-off: required

## What changes

The database gains a readiness check for the new PiggyVest money engine. For now it always answers "not ready". The direct deposit handler and the bank inbox worker, which can credit a new-engine wallet from a bank deposit, now ask it first. While it says "not ready", neither credits anything and every deposit message is kept for later.

## Why

The new engine's protections are built step by step. Without this check, deposit crediting could be switched on before they exist. A later task replaces it with the real check.

## What could go wrong and how it is prevented

A deposit could be credited too early. Both new-engine credit paths ask the check first; for now it always says no.

Older savings wallets could stop receiving deposits. While the check says no, a deposit signed with the older key is handled exactly as today with the switch off: older wallets are credited as usual, and a new-engine deposit is refused there and kept.

A deposit could be lost while it waits. A refused deposit gets "try again later": the stored copy stays pending and is retried, and after many hours is set aside for review, still stored. The bank inbox worker leaves stored messages untouched. Each deposit credits once, because crediting is tied to the provider's transaction.

The check itself could fail. Any error, timeout or odd answer counts as "not ready".

Someone could misuse the check. Only one new restricted role can run it, given only to the three internal roles that need it; customer, website and general service roles cannot. The bank inbox worker's safety check accepts exactly this role and still rejects any other extra permission.

Known effect: the activation checklists for the bank inbox and paid interest workers do not yet expect this role, so neither worker can be prepared for activation until the later task updates them. That blocks; it never moves money.

## How it is tested

With the deposit switch on, the handler never reaches the credit step: new-engine deposits get "try again later" and older-key deposits still reach the existing path. The worker claims nothing when the check says no or fails. Database tests prove the answer, who may run the check, and that unsafe permission changes are refused. A test-only helper lets later tests pretend readiness, always undone. Nothing talks to PiggyVest.

## How it stays switched off

The deposit switches stay off. Before merging, the owner confirms both are unset in production. Even if one were on, nothing new-engine credits until the real check lands.
