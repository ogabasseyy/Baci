-- Part of piggyvest_primary_engine_schema.sql (\ir): what backs a B credit.
-- Runs after the detach part with the installed session_may_write_b(), so
-- every credit here is only requested and the worker applies it. Credits are
-- capped by what backs them (the hold debit, the payout freeze or the leg),
-- counting requested credits too, and are re-checked when they are applied.

INSERT INTO public.customers(id, merchant_id) VALUES (pg_temp.id(70), pg_temp.id(2));
INSERT INTO piggyvest_primary.onboarding_intents(id, integration_id, merchant_id, customer_id, user_id,
  request_fingerprint, state, provider_customer_id, provider_wallet_id)
  VALUES (pg_temp.id(71), pg_temp.id(5), pg_temp.id(2), pg_temp.id(70), pg_temp.id(1),
    repeat('b', 64), 'verified', 'pv-engine-customer-70', 'pv-engine-main-70');
INSERT INTO public.customer_wallets(customer_id, merchant_id, available_balance)
  VALUES (pg_temp.id(70), pg_temp.id(2), 1000.00);
INSERT INTO piggyvest_primary.transfer_authorities(integration_id, capability, executor_login, enabled)
  VALUES (pg_temp.id(5), 'worker', session_user, true);
CREATE FUNCTION pg_temp.work() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_applied integer;
BEGIN
  SET LOCAL ROLE piggyvest_primary_transfer_worker;
  v_applied := piggyvest_primary.apply_requested_b_effects(50);
  RESET ROLE;
  RETURN v_applied;
END $$;
CREATE FUNCTION pg_temp.effect(p_ref text, p_effect text) RETURNS text LANGUAGE sql AS $$
  SELECT effect.state || COALESCE(':' || effect.review_reason, '') FROM piggyvest_primary.transfer_b_effects effect
  JOIN piggyvest_primary.wallet_transfers transfer ON transfer.id = effect.transfer_id
  WHERE transfer.source_ref = p_ref AND effect.effect = p_effect
$$;

-- Hold debits apply only inline, so take them in a simulated engine session.
CREATE OR REPLACE FUNCTION piggyvest_primary.session_may_write_b() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT true $$;
SELECT pg_temp.check(piggyvest_primary.request_b_effect(pg_temp.wt('collect', 'vtu', 'deliver_before_collect', 'c-r4',
  'held', 10000, jsonb_build_object('customer', pg_temp.id(70))), 'hold_debit', 10000) = 'applied'
  AND piggyvest_primary.request_b_effect(pg_temp.wt('collect', 'checkout', 'deliver_after_confirm', 'c-unpaid',
  'held', 5000, jsonb_build_object('customer', pg_temp.id(70))), 'hold_debit', 5000) = 'applied',
  'the engine session takes both hold debits');
-- Even in an engine session a restore waits while its freeze is unapplied.
SELECT pg_temp.check(piggyvest_primary.request_b_effect(pg_temp.wt('support_payout', 'support_payout', 'bank_payout',
  'c-payout-inline', 'ready', 10000), 'payout_freeze_debit', 10000) = 'requested', 'the freeze waits for the worker');
UPDATE piggyvest_primary.wallet_transfers SET state = 'cancelled' WHERE source_ref = 'c-payout-inline';
SELECT pg_temp.balance(pg_temp.id(3)) AS caps_inline_balance \gset
SELECT pg_temp.check(piggyvest_primary.request_b_effect((SELECT id FROM piggyvest_primary.wallet_transfers
  WHERE source_ref = 'c-payout-inline'), 'payout_failed_restore', 10000) = 'requested'
  AND pg_temp.balance(pg_temp.id(3)) = :caps_inline_balance,
  'a restore must not be applied inline before its freeze took B');
SELECT :'shipped_session_may_write_b' \gexec

-- R4 counts requested credits: two refunds of 6000 against a 10000 hold.
DO $$
DECLARE
  v_collect uuid := (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'c-r4');
  v_ref text;
  v_refund uuid;
BEGIN
  UPDATE piggyvest_primary.wallet_transfers SET state = 'ready' WHERE id = v_collect;
  FOREACH v_ref IN ARRAY ARRAY['c-r4-refund-a', 'c-r4-refund-b'] LOOP
    v_refund := pg_temp.wt('disbursement', 'refund', 'credit_main', v_ref, 'awaiting_collect', 6000,
      jsonb_build_object('refundOf', v_collect, 'customer', pg_temp.id(70)));
    UPDATE piggyvest_primary.wallet_transfers SET state = 'netted' WHERE id = v_refund;
  END LOOP;
  PERFORM pg_temp.check(piggyvest_primary.request_b_effect((SELECT id FROM piggyvest_primary.wallet_transfers
    WHERE source_ref = 'c-r4-refund-a'), 'refund_netted', 6000) = 'requested', 'the first refund is requested');
  PERFORM pg_temp.check(piggyvest_primary.request_b_effect((SELECT id FROM piggyvest_primary.wallet_transfers
    WHERE source_ref = 'c-r4-refund-b'), 'refund_netted', 6000) = 'review',
    'a requested credit must count against the hold debit');
  -- An unpaid checkout restores its hold once; nothing else may ride on it.
  UPDATE piggyvest_primary.wallet_transfers SET state = 'failed_unpaid' WHERE source_ref = 'c-unpaid';
  PERFORM pg_temp.check(piggyvest_primary.request_b_effect((SELECT id FROM piggyvest_primary.wallet_transfers
    WHERE source_ref = 'c-unpaid'), 'unpaid_restore', 5000) = 'requested', 'an unpaid restore of the hold is requested');
  v_refund := pg_temp.wt('disbursement', 'refund', 'credit_main', 'c-unpaid-refund', 'awaiting_collect', 1000,
    jsonb_build_object('refundOf', (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'c-unpaid'),
      'customer', pg_temp.id(70)));
  UPDATE piggyvest_primary.wallet_transfers SET state = 'netted' WHERE id = v_refund;
  PERFORM pg_temp.check(piggyvest_primary.request_b_effect((SELECT id FROM piggyvest_primary.wallet_transfers
    WHERE source_ref = 'c-unpaid-refund'), 'refund_netted', 1000) = 'review',
    'a refund on top of a full unpaid restore must go to review');
END $$;

-- A credit is bounded by its own leg, and a confirmation credit is exactly
-- what the confirmed attempt moved.
DO $$
DECLARE
  v_partial uuid := pg_temp.wt('disbursement', 'obligation', 'credit_main', 'c-partial', 'ready', 10000,
    jsonb_build_object('customer', pg_temp.id(70)));
  v_refund uuid := pg_temp.wt('disbursement', 'refund', 'credit_main', 'c-small-refund', 'awaiting_collect', 1000,
    jsonb_build_object('customer', pg_temp.id(70),
      'refundOf', (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'c-r4')));
  v_attempt uuid;
BEGIN
  PERFORM pg_temp.confirm(v_refund);
  PERFORM pg_temp.check(pg_temp.error_of(format('SELECT piggyvest_primary.request_b_effect(%L, %L, 4000)',
    v_refund, 'confirm_credit')) LIKE '%cannot exceed its leg%', 'a refund must not credit more than its own leg');
  INSERT INTO piggyvest_primary.wallet_transfer_attempts(transfer_id, attempt, reference, amount_kobo)
    VALUES (v_partial, 1, 'pvb-wt-' || v_partial || '-1', 4000) RETURNING id INTO v_attempt;
  UPDATE piggyvest_primary.wallet_transfer_attempts SET state = 'dispatching' WHERE id = v_attempt;
  UPDATE piggyvest_primary.wallet_transfer_attempts SET state = 'confirmed', proof = '{"status":"successful"}',
    provider_transaction_id = 'pv-txn-c-partial', fee_kobo = 0 WHERE id = v_attempt;
  UPDATE piggyvest_primary.wallet_transfers SET state = 'confirmed' WHERE id = v_partial;
  PERFORM pg_temp.check(pg_temp.error_of(format('SELECT piggyvest_primary.request_b_effect(%L, %L, 10000)',
    v_partial, 'confirm_credit')) LIKE '%must be the confirmed amount%',
    'a confirmation credit must not exceed what the attempt moved');
  PERFORM pg_temp.check(pg_temp.error_of(format('SELECT piggyvest_primary.request_b_effect(%L, %L, 10001)',
    v_partial, 'confirm_credit')) LIKE '%cannot exceed its leg%', 'no credit may exceed its leg');
  PERFORM pg_temp.check(piggyvest_primary.request_b_effect(v_partial, 'confirm_credit', 4000) = 'requested',
    'the confirmed amount is requested');
END $$;

-- A payout restore is applied only after its freeze took B, never instead.
-- Customer 3 has NGN 150. In request order: c-payout-inline's freeze takes
-- 100 and its restore returns it, c-payout-backed's freeze takes 100, and
-- c-payout-unbacked's freeze finds 50 and goes to review, so the restore
-- accepted while that freeze was still waiting must never credit B.
DO $$
DECLARE
  v_ref text;
BEGIN
  FOREACH v_ref IN ARRAY ARRAY['c-payout-backed', 'c-payout-unbacked'] LOOP
    PERFORM pg_temp.check(piggyvest_primary.request_b_effect(pg_temp.wt('support_payout', 'support_payout',
      'bank_payout', v_ref, 'ready', 10000), 'payout_freeze_debit', 10000) = 'requested', 'the freeze waits for the worker');
  END LOOP;
  UPDATE piggyvest_primary.wallet_transfers SET state = 'cancelled' WHERE source_ref = 'c-payout-unbacked';
  PERFORM pg_temp.check(piggyvest_primary.request_b_effect((SELECT id FROM piggyvest_primary.wallet_transfers
    WHERE source_ref = 'c-payout-unbacked'), 'payout_failed_restore', 10000) = 'requested',
    'a restore may wait for its requested freeze');
END $$;
UPDATE public.customer_wallets SET available_balance = 150.00 WHERE customer_id = pg_temp.id(3);
SELECT pg_temp.ledger_rows(pg_temp.id(3)) AS caps_ledger_before \gset
SELECT pg_temp.work() AS caps_first_pass \gset
SELECT pg_temp.check(pg_temp.effect('c-payout-backed', 'payout_freeze_debit') = 'applied'
  AND pg_temp.effect('c-payout-unbacked', 'payout_freeze_debit') = 'review:insufficient_balance'
  AND pg_temp.effect('c-payout-unbacked', 'payout_failed_restore') = 'review:debit_not_applied'
  AND pg_temp.effect('c-payout-inline', 'payout_failed_restore') = 'applied'
  AND pg_temp.balance(pg_temp.id(3)) = 50.00 AND pg_temp.ledger_rows(pg_temp.id(3)) = :caps_ledger_before + 3,
  'a restore whose freeze never took B must not credit B');
SELECT pg_temp.check(piggyvest_primary.request_b_effect((SELECT id FROM piggyvest_primary.wallet_transfers
  WHERE source_ref = 'c-payout-unbacked'), 'payout_failed_restore', 10000) = 'review',
  'repeating that restore must still answer review');
UPDATE piggyvest_primary.wallet_transfers SET state = 'cancelled' WHERE source_ref = 'c-payout-backed';
SELECT pg_temp.check(piggyvest_primary.request_b_effect((SELECT id FROM piggyvest_primary.wallet_transfers
  WHERE source_ref = 'c-payout-backed'), 'payout_failed_restore', 10000) = 'requested', 'an applied freeze is restorable');
SELECT pg_temp.work() AS caps_second_pass \gset
SELECT pg_temp.check(:caps_second_pass = 1 AND pg_temp.effect('c-payout-backed', 'payout_failed_restore') = 'applied'
  AND pg_temp.balance(pg_temp.id(3)) = 150.00 AND pg_temp.ledger_rows(pg_temp.id(3)) = :caps_ledger_before + 4,
  'an applied freeze is restored once, net zero');

-- The other credits of the first pass: refund a, the unpaid restore and the
-- partial obligation (+60, +50, +40 after holds of 100 and 50).
SELECT pg_temp.check(pg_temp.effect('c-r4-refund-a', 'refund_netted') = 'applied'
  AND pg_temp.effect('c-r4-refund-b', 'refund_netted') = 'review:credit_above_debit'
  AND pg_temp.effect('c-unpaid', 'unpaid_restore') = 'applied'
  AND pg_temp.effect('c-unpaid-refund', 'refund_netted') = 'review:credit_above_debit'
  AND pg_temp.effect('c-partial', 'confirm_credit') = 'applied'
  AND pg_temp.balance(pg_temp.id(70)) = 1000.00, 'each backed credit is applied once');
SELECT pg_temp.check(:caps_first_pass = 6, 'the first pass applies the six backed effects');

-- A goal purchase never debited B: a paid refund of it credits what reached
-- the main wallet, within the purchase; a netted one credits nothing.
DO $$
DECLARE
  v_purchase uuid := (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-goal-purchase');
  v_refund uuid := (SELECT id FROM piggyvest_primary.wallet_transfers WHERE source_ref = 'm-goal-purchase-refund');
  v_over uuid := pg_temp.wt('disbursement', 'refund', 'credit_main', 'c-goal-refund-over', 'awaiting_collect', 7000,
    jsonb_build_object('refundOf', v_purchase));
  v_netted uuid := pg_temp.wt('disbursement', 'refund', 'credit_main', 'c-goal-refund-netted', 'awaiting_collect', 500,
    jsonb_build_object('refundOf', v_purchase));
BEGIN
  PERFORM pg_temp.confirm(v_refund);
  PERFORM pg_temp.confirm(v_over);
  UPDATE piggyvest_primary.wallet_transfers SET state = 'netted' WHERE id = v_netted;
  PERFORM pg_temp.check(piggyvest_primary.request_b_effect(v_refund, 'confirm_credit', 4000) = 'requested',
    'a paid refund of a goal purchase is requested');
  PERFORM pg_temp.check(piggyvest_primary.request_b_effect(v_over, 'confirm_credit', 7000) = 'review',
    'refunds of a goal purchase must stay within the purchase');
  PERFORM pg_temp.check(piggyvest_primary.request_b_effect(v_netted, 'refund_netted', 500) = 'review',
    'a netted refund of a goal purchase must not credit B');
END $$;
SELECT pg_temp.work() AS caps_goal_pass \gset
SELECT pg_temp.check(:caps_goal_pass = 1 AND pg_temp.effect('m-goal-purchase-refund', 'confirm_credit') = 'applied'
  AND pg_temp.effect('c-goal-refund-over', 'confirm_credit') = 'review:credit_above_debit'
  AND pg_temp.effect('c-goal-refund-netted', 'refund_netted') = 'review:credit_without_debit'
  AND pg_temp.balance(pg_temp.id(3)) = 190.00, 'only the paid refund within the purchase credits B');
DELETE FROM piggyvest_primary.transfer_authorities WHERE executor_login = session_user;
