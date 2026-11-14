-- REGRESSION TEST: Paystack sales that Paystack split straight to the
-- merchant's bank (subaccount split) were credited to merchant_wallets as if
-- Baci held them. The balance could pay for GIG bookings and the weekly
-- auto-payout tried to pay it out a second time (production: one wallet,
-- 10,503,786.26, from 21 Paystack order credits). Migrations 20261103084500
-- to 20261103084504:
--   T1  an unreconciled legacy Paystack credit cannot be paid out;
--   T2  nor spent on a GIG booking;
--   T3  a Baci-collected Paystack credit (paystack_collection 'integration')
--       and a reconciled legacy credit stay spendable, exactly;
--   T4  a direct-split sale is settled history: no wallet movement,
--       idempotent, never matured by process_due_settlements;
--   T5  the recorder rejects other gateways, a missing or foreign
--       subaccount, unknown and cancelled orders;
--   T6  the GIGL variant records the customer-paid delivery fee and whether
--       Baci's split actually collected it; the checkout read returns it
--       only to a caller who proves the order's customer email;
--   T7  a cancellation refund of a direct-split sale debits nothing;
--   T8  privileges.
--
-- USAGE:
--   pnpm --filter @baci/web db:replay:chronological \
--     --sql-check supabase/tests/paystack_direct_split_settlement_history.sql
--
-- Fixture ids: d5e70<kind>00-0000-4000-8000-<n>; kind 1 merchant, 2 order,
-- 3 quote. Parts are loaded with \ir so each file stays under 300 lines.

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

\ir paystack_direct_split_settlement_history_fixtures.inc.sql
\ir paystack_direct_split_settlement_history_spend.inc.sql
\ir paystack_direct_split_settlement_history_record.inc.sql

ROLLBACK;
