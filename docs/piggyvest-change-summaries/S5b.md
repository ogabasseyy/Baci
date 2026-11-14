# S5b: switch off goal cancel and complete PIN proofs

## What changes
The goal PIN check route now only accepts the "fund" action. A request to cancel or complete a savings goal is refused straight away with the code PIN_ACTION_NOT_AVAILABLE, before any PIN is checked. A new database migration also removes the authorizer login's permission to spend cancel and complete PIN proofs. Funding a goal is unchanged.

## Why
Cancel and complete proofs are not yet tied to a number the server issues for each attempt. Until they are, a proof could be reused across attempts in ways we cannot yet rule out. It is safer to turn the path off than to ship it half bound. The later tasks S6 and S7 will tie proofs to a server-issued per-attempt operation id and then restore the permission.

## What could go wrong and how it is prevented
A customer cannot cancel or complete a goal through the PIN path while this is in place. That is intended, and the whole savings feature is still switched off in production. If the route were changed back by mistake, the database would still refuse the spend, because the permission is gone. If the permission were restored by mistake, the route would still refuse to issue the proofs. Two independent locks.

## How it is tested
Route tests confirm cancel and complete are refused with the expected code, even when the savings runtime is off, and that no PIN check or goal lookup happens. A database catalog test confirms the authorizer login cannot run the spend function, that anonymous, signed-in and service roles cannot either, and that funding remains reachable. The existing database tests were adjusted only where they assumed the old permission.

## How it stays switched off
Nothing here turns anything on. The savings features remain behind their existing flags, and this change only narrows what is allowed. S6 and S7 must re-grant the permission explicitly in their own migration.
