-- Behaviour test: notification wording can never block recording paid
-- interest (migration 20261102214500_savings_interest_notification_copy).
-- Both notifiers run inside the same transaction as the money write they
-- announce: the primary-wallet payout receipt and the legacy ledger credit.
-- Proves, against live PostgreSQL, that when the progress text cannot be
-- computed (simulated here by an error raised inside the helper):
--   * the payout receipt and the ledger credit are still recorded;
--   * each still enqueues exactly one notice with the exact naira amount and
--     the neutral "Open your savings to see your latest balance." prompt in
--     place of the progress text.
-- The helper is replaced only inside this suite's transaction and restored
-- by the final ROLLBACK. A denied EXECUTE is not simulated: it cannot be
-- trapped on the replay image, so the owner's EXECUTE and read rights are
-- asserted through the catalog in savings_interest_notification_copy.sql.
-- The copy itself is covered by savings_interest_notification_triggers.sql.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/savings_interest_notification_fallback.sql

BEGIN;
\ir savings_interest_notification_fixture.inc.sql

CREATE OR REPLACE FUNCTION savings_notifications.interest_progress(p_goal uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'simulated progress failure';
END $$;

-- 1. Primary wallet: the receipt is recorded and announced without progress.
SELECT pg_temp.receipt('fallback-payout-1', 2500);
SELECT pg_temp.check(
  (SELECT count(*) = 1 AND bool_and(receipt.net_kobo = 2500)
   FROM piggyvest_primary.paid_interest_receipts receipt
   WHERE receipt.integration_id = pg_temp.id(40) AND receipt.payout_id = 'fallback-payout-1'),
  'a progress failure must never stop the payout receipt being recorded');
SELECT pg_temp.check(
  (SELECT count(*) = 1 AND bool_and(notice.event_key = pg_temp.payout_key('fallback-payout-1')
     AND notice.title = 'Your savings just grew 🎉'
     AND notice.body = '₦25.00 interest added to your savings. Open your savings to see your latest balance.'
     AND NOT notice.voided)
   FROM pg_temp.notices(pg_temp.id(30)) notice),
  'a progress failure must fall back to the neutral balance prompt for a payout');

-- 2. Legacy ledger: the credit is recorded and announced without progress.
INSERT INTO piggyvest_savings_ledger.operations(id, integration_id, merchant_id, customer_id,
  goal_id, command, evidence_id, reference_id)
  VALUES (pg_temp.id(70), pg_temp.id(50), pg_temp.id(10), pg_temp.id(20), pg_temp.id(31),
    '{"kind":"credit_eligible_paid_interest","interestKobo":3000}', 'fallback-credit', NULL);
INSERT INTO piggyvest_savings_ledger.postings(operation_id, account, amount_kobo)
  VALUES (pg_temp.id(70), 'paid_interest', 3000), (pg_temp.id(70), 'internal_clearing', -3000);
SELECT pg_temp.check(
  (SELECT count(*) = 2 AND sum(posting.amount_kobo) = 0
   FROM piggyvest_savings_ledger.postings posting WHERE posting.operation_id = pg_temp.id(70)),
  'a progress failure must never stop the ledger credit being recorded');
SELECT pg_temp.check(
  (SELECT count(*) = 1 AND bool_and(notice.event_key = 'interest:' || pg_temp.id(70)::text
     AND notice.title = 'Your savings just grew 🎉'
     AND notice.body = '₦30.00 interest added to your savings. Open your savings to see your latest balance.'
     AND NOT notice.voided)
   FROM pg_temp.notices(pg_temp.id(31)) notice),
  'a progress failure must fall back to the neutral balance prompt for a ledger credit');

ROLLBACK;
