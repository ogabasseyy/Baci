# Primary card funding retirement: owner checks

Card top-up into the PiggyVest primary wallet is permanently retired. The web
`initialize` route answers `410 PRIMARY_CARD_FUNDING_RETIRED` before it reads
any configuration, and migration
`20261031225854_retire_primary_card_initialization` removes every role's
`EXECUTE` on the three initialization functions (`reserve`,
`claim_initialization`, `record_initialization`). Status, webhook
reconciliation, custody intake for existing references and the abandonment CLI
keep working.

Every command below is read-only. An agent must not run them against
production; the owner runs them, or approves a named person to run them, in a
read-only production session.

## Before merge: no open card reservations

1. Confirm the card schema exists (a null result means the card migrations were
   never applied, so no reservation can exist and the check passes):

   ```sql
   SELECT to_regclass('piggyvest_primary_card.operations') AS operations_table;
   ```

2. Count operations that have not reached a collected or terminal state:

   ```sql
   SELECT state, count(*) AS operations
   FROM piggyvest_primary_card.operations
   WHERE state IN ('reserved', 'initializing', 'init_unknown', 'ready')
   GROUP BY state
   ORDER BY state;
   ```

3. Count treasury holds still reserved for a card operation:

   ```sql
   SELECT count(*) AS held_reservations
   FROM piggyvest_primary_card.reservations
   WHERE state = 'reserved';
   ```

**Pass:** step 2 returns no rows and step 3 returns `0`. Merge only then.

**If step 2 shows `ready` rows:** they still drain after this change (status,
webhook and the abandonment CLI do not use the retired functions). Let them
resolve, or run the existing abandonment CLI with owner approval, then repeat
the checks.

**If step 2 shows `reserved`, `initializing` or `init_unknown` rows:** stop and
do not merge. These would need the retired functions to progress. An operator
looks up each reference (`pvb-first-primary-<operation id>`) in the Paystack
dashboard and records the outcome through the reviewed reconciliation path
before this change ships.

## After deploy: the database refuses

```sql
SELECT p.oid::regprocedure AS function, p.proacl
FROM pg_catalog.pg_proc p
WHERE p.pronamespace = 'piggyvest_primary_card'::regnamespace
  AND p.proname IN ('reserve', 'claim_initialization', 'record_initialization')
ORDER BY 1;
```

**Pass:** every row shows an empty access list (`{}`). The CI suite
`supabase/tests/primary_card_initialization_retired_privileges.sql` asserts the
same thing on every replay, and that the drain functions keep their grants.

## Rollback

There is no switch to turn card funding back on, by design. Redeploying an
older build would bring back the old route code, but the database would still
refuse at the first initialization step, so no reservation or Paystack checkout
could be created. Re-enabling card funding would need a new, reviewed migration
and an explicit owner decision.
