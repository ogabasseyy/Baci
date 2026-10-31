# A safety check that stops PiggyVest deposits being credited too early

Task: P5-readiness-gate-stub
Owner sign-off: required

## What changes

The database gains a readiness check for the new PiggyVest money engine. For now it always answers "not ready". The two places that can credit a customer's wallet from a PiggyVest bank deposit, the direct deposit handler and the bank inbox worker, now ask this check first. While the answer is "not ready", neither credits anything, and every deposit message is kept so it can be credited later.

## Why

The plan builds the new engine's protections step by step. Without this check, someone could switch on deposit crediting before those protections exist. Now "not ready" is the default from the first step, so no switch can start crediting early. A later task replaces the check with the real one.

## What could go wrong and how it is prevented

A deposit could be credited before the engine is safe. Both credit paths ask the check before doing anything, and for now it always says no.

A deposit could be lost while it waits. The direct handler answers "try again later", so the stored copy stays pending and is retried; after many hours of retries it is set aside for review, still stored. The bank inbox worker does not pick up stored messages at all, so they wait unchanged. Each deposit is credited once, never twice, because crediting stays tied to the provider's transaction (rule R5).

The check itself could fail. Any error, timeout or odd answer counts as "not ready", never as permission.

Someone could misuse the check. Only one new restricted database role can run it, and it is given only to the three internal roles that need it. Customer, public website and general service roles cannot run it.

The bank inbox worker's own safety check could weaken. It now accepts exactly this one new role and still rejects every other extra permission.

## How it is tested

Automated tests show that with the deposit switch on, the handler never reaches the credit step and answers "try again later", and the worker claims nothing when the check says no or fails. Database tests prove the exact "not ready" answer, who may run the check, and that unsafe permission changes are still refused. A test-only helper lets later database tests pretend the engine is ready, always undone afterwards. Nothing here talks to PiggyVest or moves sandbox money.

## How it stays switched off

The deposit switches stay off in production. Before merging, the owner confirms that the direct deposit switch and the bank inbox switch are not set in production. Even if one were on, nothing credits until the real readiness check replaces this one.
