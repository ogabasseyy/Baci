-- =============================================
-- REGRESSION TEST: VTU refund RPCs serialize against retry claims
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/vtu_refund_retry_serialization.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- Covers migration 20261016010000 (Codex R114): a failed row's retry
-- claim and a concurrent refund RPC must serialize on the VTU row lock
-- so a refund can never be followed by a re-vend on restored value.
--
-- NOTE: single-session script — the sequential cases below prove the
-- guard/claim semantics. The cross-session blocking proof (loser blocks
-- on the row lock, then sees the winner) is manual: hold
--   BEGIN; SELECT * FROM public.vtu_transactions WHERE id = '<tx>'
--   FOR UPDATE;  -- keep open
-- in session A, then run claim_failed_vtu_retry('<tx>') with a short
-- statement_timeout in session B and confirm it blocks, not errors.
-- =============================================

BEGIN;

ALTER TABLE public.vtu_transactions DISABLE TRIGGER USER;
ALTER TABLE public.customer_wallet_transactions DISABLE TRIGGER USER;

INSERT INTO public.customers (id, merchant_id, email)
VALUES
  ('01ac0000-0000-4000-8000-00000000cf01', '01ac0000-0000-4000-8000-00000000cf00', 'refund-retry-regression@example.com');

INSERT INTO public.customer_wallets (id, customer_id, merchant_id, available_balance, total_earned, total_redeemed)
VALUES
  ('01ac0000-0000-4000-8000-00000000cf02', '01ac0000-0000-4000-8000-00000000cf01',
    '01ac0000-0000-4000-8000-00000000cf00', 1000, 0, 500);

INSERT INTO public.vtu_transactions (
  id, merchant_id, customer_id, type, network_provider, phone_number,
  amount, request_reference, status, customer_identifier, metadata, error_message
)
VALUES
  ('01ac0000-0000-4000-8000-00000000cf11', '01ac0000-0000-4000-8000-00000000cf00',
    '01ac0000-0000-4000-8000-00000000cf01', 'airtime', 'mtn', '08012345678',
    100, 'VTU-REFUND-RETRY-1', 'failed', '1234567890', '{}', 'vend failed'),
  ('01ac0000-0000-4000-8000-00000000cf12', '01ac0000-0000-4000-8000-00000000cf00',
    '01ac0000-0000-4000-8000-00000000cf01', 'airtime', 'mtn', '08012345678',
    100, 'VTU-REFUND-RETRY-2', 'processing', '1234567890', '{}', NULL),
  ('01ac0000-0000-4000-8000-00000000cf13', '01ac0000-0000-4000-8000-00000000cf00',
    '01ac0000-0000-4000-8000-00000000cf01', 'airtime', 'mtn', '08012345678',
    100, 'VTU-REFUND-RETRY-3', 'failed', '1234567890', '{}', 'vend failed'),
  ('01ac0000-0000-4000-8000-00000000cf14', '01ac0000-0000-4000-8000-00000000cf00',
    '01ac0000-0000-4000-8000-00000000cf01', 'airtime', 'mtn', '08012345678',
    100, 'VTU-REFUND-RETRY-4', 'failed', '1234567890', '{}', 'vend failed'),
  ('01ac0000-0000-4000-8000-00000000cf15', '01ac0000-0000-4000-8000-00000000cf00',
    '01ac0000-0000-4000-8000-00000000cf01', 'airtime', 'mtn', '08012345678',
    100, 'VTU-REFUND-RETRY-5', 'failed', '1234567890', '{}', 'vend failed'),
  ('01ac0000-0000-4000-8000-00000000cf16', '01ac0000-0000-4000-8000-00000000cf00',
    '01ac0000-0000-4000-8000-00000000cf01', 'airtime', 'mtn', '08012345678',
    100, 'VTU-REFUND-RETRY-6', 'processing', '1234567890', '{}', NULL),
  ('01ac0000-0000-4000-8000-00000000cf17', '01ac0000-0000-4000-8000-00000000cf00',
    '01ac0000-0000-4000-8000-00000000cf01', 'airtime', 'mtn', '08012345678',
    100, 'VTU-REFUND-RETRY-7', 'processing', '1234567890', '{}', NULL),
  ('01ac0000-0000-4000-8000-00000000cf18', '01ac0000-0000-4000-8000-00000000cf00',
    '01ac0000-0000-4000-8000-00000000cf01', 'airtime', 'mtn', '08012345678',
    100, 'VTU-REFUND-RETRY-8', 'failed', '1234567890', '{}', 'vend failed'),
  ('01ac0000-0000-4000-8000-00000000cf19', '01ac0000-0000-4000-8000-00000000cf00',
    '01ac0000-0000-4000-8000-00000000cf01', 'airtime', 'mtn', '08012345678',
    100, 'VTU-REFUND-RETRY-9', 'processing', '1234567890', '{}', NULL);

-- Pre-existing card-leg refund for cf13, wallet-leg reversal for cf14,
-- and original debits backing the cf18/cf19 reversal cases.
INSERT INTO public.customer_wallet_transactions (
  wallet_id, customer_id, merchant_id, type, amount, balance_after,
  source_type, source_id, description
)
VALUES
  ('01ac0000-0000-4000-8000-00000000cf02', '01ac0000-0000-4000-8000-00000000cf01',
    '01ac0000-0000-4000-8000-00000000cf00', 'refund', 100, 1100,
    'vtu_transaction_refund', '01ac0000-0000-4000-8000-00000000cf13', 'fixture refund'),
  ('01ac0000-0000-4000-8000-00000000cf02', '01ac0000-0000-4000-8000-00000000cf01',
    '01ac0000-0000-4000-8000-00000000cf00', 'adjustment', 100, 1100,
    'vtu_wallet_reversal', '01ac0000-0000-4000-8000-00000000cf14', 'fixture reversal'),
  ('01ac0000-0000-4000-8000-00000000cf02', '01ac0000-0000-4000-8000-00000000cf01',
    '01ac0000-0000-4000-8000-00000000cf00', 'redemption', 100, 900,
    'vtu_wallet_payment', '01ac0000-0000-4000-8000-00000000cf18', 'fixture debit'),
  ('01ac0000-0000-4000-8000-00000000cf02', '01ac0000-0000-4000-8000-00000000cf01',
    '01ac0000-0000-4000-8000-00000000cf00', 'redemption', 100, 900,
    'vtu_wallet_payment', '01ac0000-0000-4000-8000-00000000cf19', 'fixture debit');

ALTER TABLE public.vtu_transactions ENABLE TRIGGER USER;
ALTER TABLE public.customer_wallet_transactions ENABLE TRIGGER USER;

DO $$
DECLARE
  v_cust uuid := '01ac0000-0000-4000-8000-00000000cf01';
  v_merch uuid := '01ac0000-0000-4000-8000-00000000cf00';
  v_claim record;
  v_refund record;
  v_status text;
  v_errmsg text;
  v_raised boolean;
  v_code text;
BEGIN
  -- Case 1: claim on a clean failed row claims and flips to processing.
  SELECT * INTO v_claim FROM public.claim_failed_vtu_retry('01ac0000-0000-4000-8000-00000000cf11');
  IF NOT v_claim.claimed THEN
    RAISE EXCEPTION 'REFUND-RETRY-REGRESSION: clean failed claim refused (%)', v_claim.refusal_reason;
  END IF;
  SELECT status, error_message INTO v_status, v_errmsg
  FROM public.vtu_transactions WHERE id = '01ac0000-0000-4000-8000-00000000cf11';
  IF v_status <> 'processing' OR v_errmsg IS NOT NULL THEN
    RAISE EXCEPTION 'REFUND-RETRY-REGRESSION: claim did not flip status/clear error';
  END IF;

  -- Case 2: claim on a processing row refuses with status_moved.
  SELECT * INTO v_claim FROM public.claim_failed_vtu_retry('01ac0000-0000-4000-8000-00000000cf12');
  IF v_claim.claimed OR v_claim.refusal_reason <> 'status_moved' THEN
    RAISE EXCEPTION 'REFUND-RETRY-REGRESSION: processing claim did not refuse status_moved';
  END IF;

  -- Case 3: claim on a failed row WITH a card-leg refund refuses.
  SELECT * INTO v_claim FROM public.claim_failed_vtu_retry('01ac0000-0000-4000-8000-00000000cf13');
  IF v_claim.claimed OR v_claim.refusal_reason <> 'already_refunded' THEN
    RAISE EXCEPTION 'REFUND-RETRY-REGRESSION: refunded claim did not refuse already_refunded';
  END IF;

  -- Case 4: claim on a failed row WITH a wallet-leg reversal refuses.
  SELECT * INTO v_claim FROM public.claim_failed_vtu_retry('01ac0000-0000-4000-8000-00000000cf14');
  IF v_claim.claimed OR v_claim.refusal_reason <> 'already_refunded' THEN
    RAISE EXCEPTION 'REFUND-RETRY-REGRESSION: reversed claim did not refuse already_refunded';
  END IF;

  -- Case 5: claim on a missing row refuses with missing.
  SELECT * INTO v_claim FROM public.claim_failed_vtu_retry('01ac0000-0000-4000-8000-00000000cfff');
  IF v_claim.claimed OR v_claim.refusal_reason <> 'missing' THEN
    RAISE EXCEPTION 'REFUND-RETRY-REGRESSION: missing claim did not refuse missing';
  END IF;

  -- Case 6: refund RPC with matching expected status succeeds.
  SELECT * INTO v_refund FROM public.refund_customer_wallet_for_vtu(
    v_cust, v_merch, 100, '01ac0000-0000-4000-8000-00000000cf15', 'regression', 'failed');
  IF NOT v_refund.success THEN
    RAISE EXCEPTION 'REFUND-RETRY-REGRESSION: matching-status refund did not succeed';
  END IF;

  -- Case 7: refund RPC with a moved status raises 42501.
  v_raised := false;
  BEGIN
    PERFORM public.refund_customer_wallet_for_vtu(
      v_cust, v_merch, 100, '01ac0000-0000-4000-8000-00000000cf16', 'regression', 'failed');
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'REFUND-RETRY-REGRESSION: moved-status refund did not raise 42501';
  END IF;

  -- Case 8: refund RPC with NULL expected keeps legacy behavior.
  SELECT * INTO v_refund FROM public.refund_customer_wallet_for_vtu(
    v_cust, v_merch, 100, '01ac0000-0000-4000-8000-00000000cf17', 'regression', NULL);
  IF NOT v_refund.success THEN
    RAISE EXCEPTION 'REFUND-RETRY-REGRESSION: NULL-expected refund did not succeed';
  END IF;

  -- Case 9: reverse RPC with matching expected status succeeds.
  SELECT * INTO v_refund FROM public.reverse_vtu_wallet_payment(
    '01ac0000-0000-4000-8000-00000000cf18', 'regression', v_merch, 'failed');
  IF NOT v_refund.success THEN
    RAISE EXCEPTION 'REFUND-RETRY-REGRESSION: matching-status reversal did not succeed';
  END IF;

  -- Case 10: reverse RPC with a moved status raises 42501.
  v_raised := false;
  BEGIN
    PERFORM public.reverse_vtu_wallet_payment(
      '01ac0000-0000-4000-8000-00000000cf19', 'regression', v_merch, 'failed');
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'REFUND-RETRY-REGRESSION: moved-status reversal did not raise 42501';
  END IF;

  RAISE NOTICE 'REFUND-RETRY-REGRESSION: all 10 cases passed';
END;
$$;

ROLLBACK;
