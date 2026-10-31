-- Behaviour test: paid-interest notifications after migration
-- 20261031222257_savings_interest_notification_copy. Proves, against live
-- PostgreSQL, for both paid-interest sources:
--   * every recorded paid-interest insert with a positive amount enqueues
--     exactly one notification, keyed to that payout or ledger operation, with
--     the "Your savings just grew" title, the exact naira amount and the
--     goal's progress after the credit (principal plus net paid interest);
--   * a zero-net payout, an accrual (pending interest), a non-interest
--     posting and moving existing interest for a purchase enqueue nothing;
--   * a reversal enqueues nothing new and voids the original notice.
-- Fixture rows follow plan_transfer_interest_headroom.sql. Only the paid
-- interest crosswalk is inserted with replication triggers suspended: its own
-- provisioning chain is out of scope and only its row is needed for the
-- receipt foreign key. Every notifying insert runs with triggers enabled.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/savings_interest_notification_triggers.sql

BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

CREATE FUNCTION pg_temp.id(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('a7c00000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

-- Interest notices for one goal: (event_key, title, body, voided).
CREATE FUNCTION pg_temp.notices(p_goal uuid)
RETURNS TABLE(event_key text, title text, body text, voided boolean) LANGUAGE sql AS $$
  SELECT event.event_key, event.title, event.body, event.voided_at IS NOT NULL
  FROM savings_notifications.events event
  WHERE event.goal_id = p_goal AND event.type = 'interest_credited'
  ORDER BY event.event_key
$$;

CREATE FUNCTION pg_temp.payout_key(p_payout text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'primary-interest:' || pg_temp.id(40)::text || ':' || p_payout
$$;

CREATE FUNCTION pg_temp.receipt(p_payout text, p_net bigint) RETURNS void LANGUAGE sql AS $$
  INSERT INTO piggyvest_primary.paid_interest_receipts(integration_id, payout_id, crosswalk_id,
    goal_id, merchant_id, customer_id, net_kobo, financial_identity, body_digest)
  VALUES (pg_temp.id(40), p_payout, pg_temp.id(41), pg_temp.id(30), pg_temp.id(10),
    pg_temp.id(20), p_net, jsonb_build_object('payoutId', p_payout), repeat('a', 64))
$$;

-- Fixture: one customer with a primary-wallet goal (30) and a legacy ledger
-- goal (31), each targeting ₦1,000 with ₦200 of principal saved.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users(id) VALUES (pg_temp.id(1));
INSERT INTO public.merchants(id, email) VALUES (pg_temp.id(10), 'interest-copy@example.com');
INSERT INTO public.products(id, merchant_id, name, price, status, stock_quantity)
  VALUES (pg_temp.id(11), pg_temp.id(10), 'Interest copy device', 1000, 'active', 3);
INSERT INTO public.customers(id, merchant_id, user_id) VALUES (pg_temp.id(20), pg_temp.id(10), pg_temp.id(1));
INSERT INTO public.customer_savings_goals(id, merchant_id, customer_id, product_id, title, status,
  source_mode, target_amount, current_amount, contribution_amount, contribution_frequency,
  start_date, maturity_date, terms_accepted_at, non_withdrawable_accepted_at)
SELECT pg_temp.id(n), pg_temp.id(10), pg_temp.id(20), pg_temp.id(11), 'Interest copy goal', 'active',
  'manual', 1000, 200, 100, 'daily', current_date, current_date + 30, now(), now()
FROM (VALUES (30), (31)) AS goal(n);

INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES (pg_temp.id(40), pg_temp.id(10), 'interest-copy-business', 'production',
    'interest_copy_fixture_executor', true);
SET LOCAL session_replication_role = replica;
INSERT INTO piggyvest_primary.paid_interest_crosswalks(id, integration_id, goal_id, api_wallet_id,
  api_customer_id, onboarding_customer_id, webhook_customer_id, source_wallet_id, accrued_wallet_id,
  destination_wallet_id, envelope_destination_wallet_id, provider_evidence_sha256,
  policy_evidence_sha256, policy_reference, allocation_policy, enabled)
VALUES (pg_temp.id(41), pg_temp.id(40), pg_temp.id(30), 'copy-api-wallet', 'copy-api-customer',
  'copy-onboarding-customer', 'copy-webhook-customer', 'copy-source', 'copy-accrued',
  'copy-destination', NULL, repeat('a', 64), repeat('b', 64), 'synthetic-interest-copy-fixture',
  'provider_net_is_customer_plan_interest', true);
SET LOCAL session_replication_role = origin;

INSERT INTO piggyvest_staging.integrations(id, expected_provider_account_id, enabled)
  VALUES (pg_temp.id(50), 'provider-acct-interest-copy', true);
INSERT INTO piggyvest_savings_ledger.bindings(goal_id, integration_id, merchant_id, customer_id,
  authorized_login, enabled)
  VALUES (pg_temp.id(31), pg_temp.id(50), pg_temp.id(10), pg_temp.id(20), 'postgres', true);

-- 1. Primary wallet: one positive net payout is one notice with progress.
SELECT pg_temp.receipt('copy-payout-1', 15000);
SELECT pg_temp.check(
  (SELECT count(*) = 1 AND bool_and(notice.event_key = pg_temp.payout_key('copy-payout-1')
     AND notice.title = 'Your savings just grew 🎉'
     AND notice.body = '₦150.00 interest added to your savings. You’re now 35% of the way there.'
     AND NOT notice.voided)
   FROM pg_temp.notices(pg_temp.id(30)) notice),
  'a ₦150 payout on a ₦200/₦1,000 goal must enqueue one notice reading 35%');

-- 2. A zero-net payout is recorded but never celebrated.
SELECT pg_temp.receipt('copy-payout-0', 0);
SELECT pg_temp.check((SELECT count(*) = 1 FROM pg_temp.notices(pg_temp.id(30))),
  'a zero-net payout must not enqueue a notice');

-- 3. Two payouts in one statement are two notices; passing the target reads
-- as reached (₦200 + ₦150 + ₦500 + ₦200 = ₦1,050 of ₦1,000).
INSERT INTO piggyvest_primary.paid_interest_receipts(integration_id, payout_id, crosswalk_id,
  goal_id, merchant_id, customer_id, net_kobo, financial_identity, body_digest)
SELECT pg_temp.id(40), payout.id, pg_temp.id(41), pg_temp.id(30), pg_temp.id(10), pg_temp.id(20),
  payout.net, jsonb_build_object('payoutId', payout.id), repeat('a', 64)
FROM (VALUES ('copy-payout-2', 50000::bigint), ('copy-payout-3', 20000::bigint)) AS payout(id, net);
SELECT pg_temp.check(
  (SELECT count(*) = 3 FROM pg_temp.notices(pg_temp.id(30))),
  'each paid-interest insert must enqueue exactly one notice');
SELECT pg_temp.check(
  (SELECT body = '₦500.00 interest added to your savings. Goal reached! 🎉'
   FROM pg_temp.notices(pg_temp.id(30)) WHERE event_key = pg_temp.payout_key('copy-payout-2'))
  AND (SELECT body = '₦200.00 interest added to your savings. Goal reached! 🎉'
   FROM pg_temp.notices(pg_temp.id(30)) WHERE event_key = pg_temp.payout_key('copy-payout-3')),
  'savings above the target must read as goal reached');

-- 4. A reversal voids its payout notice and enqueues nothing new.
INSERT INTO piggyvest_primary.paid_interest_reversals(integration_id, provider_reversal_id, payout_id,
  amount_kobo, provider_evidence_sha256, evidence_reference)
  VALUES (pg_temp.id(40), 'copy-reversal-1', 'copy-payout-1', 15000, repeat('c', 64),
    'synthetic-interest-copy-reversal');
SELECT pg_temp.check(
  (SELECT count(*) = 3
     AND bool_and(notice.voided = (notice.event_key = pg_temp.payout_key('copy-payout-1')))
   FROM pg_temp.notices(pg_temp.id(30)) notice),
  'a reversal must void only its own payout notice and enqueue nothing');

-- 5. Legacy ledger: an accrual and a non-interest posting are silent.
INSERT INTO piggyvest_savings_ledger.operations(id, integration_id, merchant_id, customer_id,
  goal_id, command, evidence_id, reference_id)
  VALUES (pg_temp.id(60), pg_temp.id(50), pg_temp.id(10), pg_temp.id(20), pg_temp.id(31),
    '{"kind":"record_pending_interest","interestKobo":20000}', 'copy-accrual', NULL);
INSERT INTO piggyvest_savings_ledger.postings(operation_id, account, amount_kobo)
  VALUES (pg_temp.id(60), 'pending_interest', 20000), (pg_temp.id(60), 'pending_clearing', -20000);
SELECT pg_temp.check((SELECT count(*) = 0 FROM pg_temp.notices(pg_temp.id(31))),
  'an interest accrual must never enqueue an earned-interest notice');

-- 6. Legacy ledger: one credited paid-interest posting is one notice. The
-- balancing clearing leg is silent, and the progress counts the credit once.
INSERT INTO piggyvest_savings_ledger.operations(id, integration_id, merchant_id, customer_id,
  goal_id, command, evidence_id, reference_id)
  VALUES (pg_temp.id(61), pg_temp.id(50), pg_temp.id(10), pg_temp.id(20), pg_temp.id(31),
    '{"kind":"credit_eligible_paid_interest","interestKobo":5000}', 'copy-credit', NULL);
INSERT INTO piggyvest_savings_ledger.postings(operation_id, account, amount_kobo)
  VALUES (pg_temp.id(61), 'paid_interest', 5000), (pg_temp.id(61), 'internal_clearing', -5000);
SELECT pg_temp.check(
  (SELECT count(*) = 1 AND bool_and(notice.event_key = 'interest:' || pg_temp.id(61)::text
     AND notice.title = 'Your savings just grew 🎉'
     AND notice.body = '₦50.00 interest added to your savings. You’re now 25% of the way there.'
     AND NOT notice.voided)
   FROM pg_temp.notices(pg_temp.id(31)) notice),
  'a ₦50 ledger credit on a ₦200/₦1,000 goal must enqueue one notice reading 25%');
SELECT pg_temp.check(
  savings_notifications.interest_progress(pg_temp.id(30)) = 'You’re now 90% of the way there.',
  'another goal''s ledger credit must never count toward this goal (₦900 of ₦1,000)');

-- 7. Legacy ledger: reserving paid interest for a purchase and releasing it
-- back moves existing interest, so neither enqueues a notice.
INSERT INTO piggyvest_savings_ledger.operations(id, integration_id, merchant_id, customer_id,
  goal_id, command, evidence_id, reference_id)
  VALUES (pg_temp.id(63), pg_temp.id(50), pg_temp.id(10), pg_temp.id(20), pg_temp.id(31),
    '{"kind":"reserve_purchase","principalKobo":0,"interestKobo":2000}', 'copy-reserve', NULL);
INSERT INTO piggyvest_savings_ledger.postings(operation_id, account, amount_kobo)
  VALUES (pg_temp.id(63), 'paid_interest', -2000), (pg_temp.id(63), 'purchase_interest', 2000);
INSERT INTO piggyvest_savings_ledger.operations(id, integration_id, merchant_id, customer_id,
  goal_id, command, evidence_id, reference_id)
  VALUES (pg_temp.id(64), pg_temp.id(50), pg_temp.id(10), pg_temp.id(20), pg_temp.id(31),
    '{"kind":"release_purchase"}', 'copy-release', pg_temp.id(63));
INSERT INTO piggyvest_savings_ledger.postings(operation_id, account, amount_kobo)
  VALUES (pg_temp.id(64), 'purchase_interest', -2000), (pg_temp.id(64), 'paid_interest', 2000);
SELECT pg_temp.check(
  (SELECT count(*) = 1 AND bool_and(NOT notice.voided) FROM pg_temp.notices(pg_temp.id(31)) notice),
  'moving existing paid interest must neither enqueue nor void a notice');

-- 8. Legacy ledger: the reversal voids the notice and enqueues nothing new.
INSERT INTO piggyvest_savings_ledger.operations(id, integration_id, merchant_id, customer_id,
  goal_id, command, evidence_id, reference_id)
  VALUES (pg_temp.id(62), pg_temp.id(50), pg_temp.id(10), pg_temp.id(20), pg_temp.id(31),
    '{"kind":"reverse_credit","interestKobo":0}', 'copy-reversal', pg_temp.id(61));
INSERT INTO piggyvest_savings_ledger.postings(operation_id, account, amount_kobo)
  VALUES (pg_temp.id(62), 'paid_interest', -5000), (pg_temp.id(62), 'internal_clearing', 5000);
SELECT pg_temp.check(
  (SELECT count(*) = 1 AND bool_and(notice.voided) FROM pg_temp.notices(pg_temp.id(31)) notice),
  'a ledger reversal must void the credited notice and enqueue nothing');

-- 9. Progress after the reversals counts net paid interest only.
SELECT pg_temp.check(
  savings_notifications.interest_progress(pg_temp.id(31)) = 'You’re now 20% of the way there.',
  'reversed ledger interest must leave only principal in the progress');
SELECT pg_temp.check(
  savings_notifications.interest_progress(pg_temp.id(30)) = 'You’re now 90% of the way there.',
  'primary progress must subtract the reversed payout (₦900 of ₦1,000)');

ROLLBACK;
