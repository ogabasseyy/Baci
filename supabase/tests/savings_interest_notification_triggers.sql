-- Behaviour test: paid-interest notifications after migration
-- 20261102214500_savings_interest_notification_copy. Proves, against live
-- PostgreSQL, for both paid-interest sources:
--   * every recorded paid-interest insert with a positive amount enqueues
--     exactly one notification, keyed to that payout or ledger operation, with
--     the "Your savings just grew" title, the exact naira amount and the
--     goal's progress after the credit (principal plus net paid interest, the
--     same per-goal interest the app's savings display adds: interest
--     reserved for a purchase is left out until it is released, and every
--     partial reversal of a payout is subtracted once, matched on its
--     integration);
--   * no interest notice ever claims the goal is reached, so a reversal that
--     takes the goal back below target leaves no live completion claim;
--   * a zero-net payout, an accrual (pending interest), a non-interest
--     posting and moving existing interest for a purchase enqueue nothing;
--   * a reversal enqueues nothing new and voids the original notice.
-- The shared fixture (savings_interest_notification_fixture.inc.sql) sets up
-- the goals, integrations, crosswalks and ledger binding.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/savings_interest_notification_triggers.sql

BEGIN;
\ir savings_interest_notification_fixture.inc.sql

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

-- 3. Two payouts in one statement are two notices. Passing the target
-- (₦200 + ₦150 + ₦500 + ₦200 = ₦1,050 of ₦1,000) points to the live balance
-- and never claims completion, because a later reversal can undo it.
INSERT INTO piggyvest_primary.paid_interest_receipts(integration_id, payout_id, crosswalk_id,
  goal_id, merchant_id, customer_id, net_kobo, financial_identity, body_digest)
SELECT pg_temp.id(40), payout.id, pg_temp.id(41), pg_temp.id(30), pg_temp.id(10), pg_temp.id(20),
  payout.net, jsonb_build_object('payoutId', payout.id), repeat('a', 64)
FROM (VALUES ('copy-payout-2', 50000::bigint), ('copy-payout-3', 20000::bigint)) AS payout(id, net);
SELECT pg_temp.check(
  (SELECT count(*) = 3 FROM pg_temp.notices(pg_temp.id(30))),
  'each paid-interest insert must enqueue exactly one notice');
SELECT pg_temp.check(
  (SELECT body = '₦500.00 interest added to your savings. Open your savings to see your latest balance.'
   FROM pg_temp.notices(pg_temp.id(30)) WHERE event_key = pg_temp.payout_key('copy-payout-2'))
  AND (SELECT body = '₦200.00 interest added to your savings. Open your savings to see your latest balance.'
   FROM pg_temp.notices(pg_temp.id(30)) WHERE event_key = pg_temp.payout_key('copy-payout-3')),
  'savings above the target must point to the balance, never claim the goal is reached');

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
SELECT pg_temp.check(
  NOT EXISTS (SELECT 1 FROM pg_temp.notices(pg_temp.id(30)) notice
    WHERE NOT notice.voided AND notice.body ~* '(reached|complete)'),
  'once a reversal takes the goal below target (₦900 of ₦1,000) no live interest notice may claim completion');

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
-- back moves existing interest, so neither enqueues a notice. Progress uses
-- the interest the app's savings display shows, which leaves reserved
-- interest out, so a credit while the reservation is open is announced with
-- the same figure the customer then sees (₦200 + ₦50 - ₦20 + ₦10 = ₦240 of
-- ₦1,000), and releasing the reservation restores it.
INSERT INTO piggyvest_savings_ledger.operations(id, integration_id, merchant_id, customer_id,
  goal_id, command, evidence_id, reference_id)
  VALUES (pg_temp.id(63), pg_temp.id(50), pg_temp.id(10), pg_temp.id(20), pg_temp.id(31),
    '{"kind":"reserve_purchase","principalKobo":0,"interestKobo":2000}', 'copy-reserve', NULL);
INSERT INTO piggyvest_savings_ledger.postings(operation_id, account, amount_kobo)
  VALUES (pg_temp.id(63), 'paid_interest', -2000), (pg_temp.id(63), 'purchase_interest', 2000);
SELECT pg_temp.check(
  savings_notifications.interest_progress(pg_temp.id(31)) = 'You’re now 23% of the way there.',
  'interest reserved for a purchase must leave progress, as it leaves the app display (₦230 of ₦1,000)');
INSERT INTO piggyvest_savings_ledger.operations(id, integration_id, merchant_id, customer_id,
  goal_id, command, evidence_id, reference_id)
  VALUES (pg_temp.id(65), pg_temp.id(50), pg_temp.id(10), pg_temp.id(20), pg_temp.id(31),
    '{"kind":"credit_eligible_paid_interest","interestKobo":1000}', 'copy-credit-reserved', NULL);
INSERT INTO piggyvest_savings_ledger.postings(operation_id, account, amount_kobo)
  VALUES (pg_temp.id(65), 'paid_interest', 1000), (pg_temp.id(65), 'internal_clearing', -1000);
SELECT pg_temp.check(
  (SELECT body = '₦10.00 interest added to your savings. You’re now 24% of the way there.'
   FROM pg_temp.notices(pg_temp.id(31)) WHERE event_key = 'interest:' || pg_temp.id(65)::text),
  'a credit while a purchase reservation is open must match the app display (24%, not 26%)');
INSERT INTO piggyvest_savings_ledger.operations(id, integration_id, merchant_id, customer_id,
  goal_id, command, evidence_id, reference_id)
  VALUES (pg_temp.id(64), pg_temp.id(50), pg_temp.id(10), pg_temp.id(20), pg_temp.id(31),
    '{"kind":"release_purchase"}', 'copy-release', pg_temp.id(63));
INSERT INTO piggyvest_savings_ledger.postings(operation_id, account, amount_kobo)
  VALUES (pg_temp.id(64), 'purchase_interest', -2000), (pg_temp.id(64), 'paid_interest', 2000);
SELECT pg_temp.check(
  (SELECT count(*) = 2 AND bool_and(NOT notice.voided) FROM pg_temp.notices(pg_temp.id(31)) notice),
  'moving existing paid interest must neither enqueue nor void a notice');
SELECT pg_temp.check(
  savings_notifications.interest_progress(pg_temp.id(31)) = 'You’re now 26% of the way there.',
  'releasing a purchase reservation must restore its interest to progress (₦260 of ₦1,000)');

-- 8. Legacy ledger: the reversal voids the notice and enqueues nothing new.
INSERT INTO piggyvest_savings_ledger.operations(id, integration_id, merchant_id, customer_id,
  goal_id, command, evidence_id, reference_id)
  VALUES (pg_temp.id(62), pg_temp.id(50), pg_temp.id(10), pg_temp.id(20), pg_temp.id(31),
    '{"kind":"reverse_credit","interestKobo":0}', 'copy-reversal', pg_temp.id(61));
INSERT INTO piggyvest_savings_ledger.postings(operation_id, account, amount_kobo)
  VALUES (pg_temp.id(62), 'paid_interest', -5000), (pg_temp.id(62), 'internal_clearing', 5000);
SELECT pg_temp.check(
  (SELECT count(*) = 2
     AND bool_and(notice.voided = (notice.event_key = 'interest:' || pg_temp.id(61)::text))
   FROM pg_temp.notices(pg_temp.id(31)) notice),
  'a ledger reversal must void only the notice it reverses and enqueue nothing');

-- 9. Progress after the reversals counts net paid interest only.
SELECT pg_temp.check(
  savings_notifications.interest_progress(pg_temp.id(31)) = 'You’re now 21% of the way there.',
  'reversed ledger interest must leave principal plus the unreversed ₦10 credit (₦210 of ₦1,000)');
SELECT pg_temp.check(
  savings_notifications.interest_progress(pg_temp.id(30)) = 'You’re now 90% of the way there.',
  'primary progress must subtract the reversed payout (₦900 of ₦1,000)');

-- 10. Primary wallet: several partial reversals of one payout are summed once
-- for that payout, never once per reversal row, and the payout's remainder
-- still counts (₦900 + ₦50 - ₦10 - ₦20 = ₦920 of ₦1,000). A reversal of the
-- same payout id under another integration never touches this goal.
SELECT pg_temp.receipt('copy-payout-4', 5000);
SELECT pg_temp.check(
  (SELECT body = '₦50.00 interest added to your savings. You’re now 95% of the way there.'
   FROM pg_temp.notices(pg_temp.id(30)) WHERE event_key = pg_temp.payout_key('copy-payout-4')),
  'a ₦50 payout on a ₦900/₦1,000 goal must read 95%');
INSERT INTO piggyvest_primary.paid_interest_reversals(integration_id, provider_reversal_id, payout_id,
  amount_kobo, provider_evidence_sha256, evidence_reference)
  VALUES (pg_temp.id(40), 'copy-reversal-4a', 'copy-payout-4', 1000, repeat('d', 64),
    'synthetic-interest-copy-partial-reversal-a'),
  (pg_temp.id(40), 'copy-reversal-4b', 'copy-payout-4', 2000, repeat('e', 64),
    'synthetic-interest-copy-partial-reversal-b');
SELECT pg_temp.check(
  (SELECT voided FROM pg_temp.notices(pg_temp.id(30)) WHERE event_key = pg_temp.payout_key('copy-payout-4')),
  'a partial reversal must void its payout notice');
SELECT pg_temp.check(
  savings_notifications.interest_progress(pg_temp.id(30)) = 'You’re now 92% of the way there.',
  'primary progress must subtract every partial reversal of a payout exactly once (₦920 of ₦1,000)');
INSERT INTO piggyvest_primary.paid_interest_receipts(integration_id, payout_id, crosswalk_id,
  goal_id, merchant_id, customer_id, net_kobo, financial_identity, body_digest)
  VALUES (pg_temp.id(42), 'copy-payout-4', pg_temp.id(43), pg_temp.id(32), pg_temp.id(10),
    pg_temp.id(20), 4000, jsonb_build_object('payoutId', 'copy-payout-4'), repeat('a', 64));
INSERT INTO piggyvest_primary.paid_interest_reversals(integration_id, provider_reversal_id, payout_id,
  amount_kobo, provider_evidence_sha256, evidence_reference)
  VALUES (pg_temp.id(42), 'copy-reversal-4c', 'copy-payout-4', 4000, repeat('f', 64),
    'synthetic-interest-copy-other-integration-reversal');
SELECT pg_temp.check(
  savings_notifications.interest_progress(pg_temp.id(30)) = 'You’re now 92% of the way there.',
  'another integration''s reversal of the same payout id must not change this goal (₦920 of ₦1,000)');
SELECT pg_temp.check(
  savings_notifications.interest_progress(pg_temp.id(32)) = 'You’re now 20% of the way there.',
  'the other integration''s goal must net its own reversed payout (₦200 of ₦1,000)');

-- 11. A receipt recorded under a non-production integration is not interest
-- the app's savings display counts, so the notice progress must not either
-- (the goal stays at ₦200 of ₦1,000).
INSERT INTO piggyvest_primary.paid_interest_receipts(integration_id, payout_id, crosswalk_id,
  goal_id, merchant_id, customer_id, net_kobo, financial_identity, body_digest)
  VALUES (pg_temp.id(44), 'copy-payout-staging', pg_temp.id(45), pg_temp.id(33), pg_temp.id(10),
    pg_temp.id(20), 30000, jsonb_build_object('payoutId', 'copy-payout-staging'), repeat('a', 64));
SELECT pg_temp.check(
  savings_notifications.interest_progress(pg_temp.id(33)) = 'You’re now 20% of the way there.',
  'a staging-environment receipt must not raise the progress above what the app displays');
-- The notifier is gated the same way: it must not announce interest its own
-- progress text, and the app's savings display, refuse to count.
SELECT pg_temp.check((SELECT count(*) = 0 FROM pg_temp.notices(pg_temp.id(33))),
  'a staging-environment receipt must not enqueue a customer-facing interest notice');

-- 12. A goal outside active/paused/completed has no per-goal interest in the
-- app's savings display, so its notice carries the neutral prompt, not a
-- percentage.
INSERT INTO public.customer_savings_goals(id, merchant_id, customer_id, product_id, title, status,
  source_mode, target_amount, current_amount, contribution_amount, contribution_frequency,
  start_date, maturity_date, terms_accepted_at, non_withdrawable_accepted_at)
  VALUES (pg_temp.id(34), pg_temp.id(10), pg_temp.id(20), pg_temp.id(11), 'Interest copy goal',
    'cancelled', 'manual', 1000, 200, 100, 'daily', current_date, current_date + 30, now(), now());
SELECT pg_temp.check(
  savings_notifications.interest_progress(pg_temp.id(34)) = 'Open your savings to see your latest balance.',
  'a cancelled goal must read the neutral prompt, never a progress percentage');

-- 13. A payout on a completed goal, through the real primary-wallet trigger,
-- carries the exact title and the neutral at-target line (never a completion
-- claim).
INSERT INTO public.customer_savings_goals(id, merchant_id, customer_id, product_id, title, status,
  source_mode, target_amount, current_amount, contribution_amount, contribution_frequency,
  start_date, maturity_date, terms_accepted_at, non_withdrawable_accepted_at)
  VALUES (pg_temp.id(35), pg_temp.id(10), pg_temp.id(20), pg_temp.id(11), 'Interest copy goal',
    'completed', 'manual', 1000, 1000, 100, 'daily', current_date, current_date + 30, now(), now());
SET LOCAL session_replication_role = replica;
INSERT INTO piggyvest_primary.paid_interest_crosswalks(id, integration_id, goal_id, api_wallet_id,
  api_customer_id, onboarding_customer_id, webhook_customer_id, source_wallet_id, accrued_wallet_id,
  destination_wallet_id, envelope_destination_wallet_id, provider_evidence_sha256,
  policy_evidence_sha256, policy_reference, allocation_policy, enabled)
VALUES (pg_temp.id(46), pg_temp.id(40), pg_temp.id(35), 'copy-api-wallet-c', 'copy-api-customer-c',
  'copy-onboarding-customer-c', 'copy-webhook-customer-c', 'copy-source-c', 'copy-accrued-c',
  'copy-destination-c', NULL, repeat('a', 64), repeat('b', 64), 'synthetic-interest-copy-fixture-c',
  'provider_net_is_customer_plan_interest', true);
SET LOCAL session_replication_role = origin;
INSERT INTO piggyvest_primary.paid_interest_receipts(integration_id, payout_id, crosswalk_id,
  goal_id, merchant_id, customer_id, net_kobo, financial_identity, body_digest)
  VALUES (pg_temp.id(40), 'copy-payout-completed', pg_temp.id(46), pg_temp.id(35), pg_temp.id(10),
    pg_temp.id(20), 3000, jsonb_build_object('payoutId', 'copy-payout-completed'), repeat('a', 64));
SELECT pg_temp.check(
  (SELECT count(*) = 1 AND bool_and(notice.title = 'Your savings just grew 🎉'
     AND notice.body = '₦30.00 interest added to your savings. Open your savings to see your latest balance.')
   FROM pg_temp.notices(pg_temp.id(35)) notice),
  'a ₦30 payout on a completed goal must enqueue one notice with the neutral at-target line');

ROLLBACK;
