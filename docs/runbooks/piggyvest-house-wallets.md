# Registering Ogabassey's PiggyVest house wallets

Owner-only. The transfer engine moves money between customer wallets and
Ogabassey's own PiggyVest wallets: **Collection**, **Interest** and **Fee**.
They are recorded in `piggyvest_primary.house_wallets`. No migration, API
route or engine login writes this table: the owner registers the wallets with
the SQL below, as the database owner, after approving the change.

The engine treats the registry as not ready until all three wallets are
registered, verified and enabled (`apps/web/src/lib/piggyvest/house-wallets.ts`).

## Rules the database enforces

- One wallet per role for an integration, and each PiggyVest wallet id once.
- The wallet's business must be the integration's PiggyVest business.
- A customer's main or goal wallet is refused.
- A wallet can be enabled only once it is verified. After verification its id,
  role, business and verification time are locked and the row cannot be
  deleted; only `enabled` can still be switched off and on.

## Steps

1. Create the three wallets in the PiggyVest business dashboard and note each
   wallet id. Confirm in the dashboard that each one belongs to Ogabassey's
   business and is not a customer wallet.
2. Register them unverified (a mistake can still be corrected or deleted):

   ```sql
   BEGIN;
   INSERT INTO piggyvest_primary.house_wallets (integration_id, role, provider_wallet_id, business_id)
   VALUES
     ('<integration id>', 'collection', '<collection wallet id>', '<business id>'),
     ('<integration id>', 'interest', '<interest wallet id>', '<business id>'),
     ('<integration id>', 'fee', '<fee wallet id>', '<business id>');
   SELECT role, provider_wallet_id, business_id, enabled, verified
   FROM piggyvest_primary.read_house_wallets('<integration id>');
   COMMIT;
   ```

3. Check the three rows against the dashboard a second time. Then verify and
   enable them. This cannot be undone:

   ```sql
   UPDATE piggyvest_primary.house_wallets
   SET verified_at = clock_timestamp(), enabled = true
   WHERE integration_id = '<integration id>' AND verified_at IS NULL;
   ```

## Switching a wallet off

`UPDATE piggyvest_primary.house_wallets SET enabled = false WHERE id = '<row id>';`
stops new transfers from using it. Transfers already created keep the wallet
id they were created with.
