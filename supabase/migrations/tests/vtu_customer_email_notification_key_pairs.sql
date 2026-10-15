-- =============================================
-- REGRESSION TEST: VTU customer-email RPCs pair-validate keys
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/vtu_customer_email_notification_key_pairs.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- Covers migration 20261015232000 (Muse R108 LOW): the claim and fenced
-- clear RPCs must accept only the two valid (attempt, sent) pairs —
-- receipt<->receipt and token<->token. A mismatched call (receipt
-- attempt + token sent, or vice versa) must raise 22023 instead of
-- claiming/guarding against the wrong sent flag.
-- =============================================

BEGIN;

ALTER TABLE public.vtu_transactions DISABLE TRIGGER USER;
INSERT INTO public.vtu_transactions (
  id, merchant_id, customer_id, type, network_provider, phone_number,
  amount, request_reference, status, customer_identifier, metadata
)
VALUES
  ('01ac0000-0000-4000-8000-00000000eb10', '01ac0000-0000-4000-8000-00000000ab10',
    '01ac0000-0000-4000-8000-00000000ab20', 'airtime', 'mtn', '08012345678',
    100, 'VTU-EMAIL-PAIR-REGRESSION-1', 'pending', '1234567890',
    '{}');
ALTER TABLE public.vtu_transactions ENABLE TRIGGER USER;

DO $$
DECLARE
  v_tx uuid := '01ac0000-0000-4000-8000-00000000eb10';
  v_meta jsonb;
  v_stamp text;
  v_raised boolean;
BEGIN
  -- Case 1: mismatched claim (receipt attempt + token sent) raises.
  v_raised := false;
  BEGIN
    PERFORM public.claim_vtu_customer_email_notification_attempt(
      v_tx,
      'customerReceiptEmailNotificationAttempted',
      'customerTokenEmailNotificationSent'
    );
  EXCEPTION WHEN invalid_parameter_value THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'EMAIL-PAIR-REGRESSION: mismatched claim (receipt attempt + token sent) did not raise';
  END IF;

  -- Case 2: mismatched claim (token attempt + receipt sent) raises.
  v_raised := false;
  BEGIN
    PERFORM public.claim_vtu_customer_email_notification_attempt(
      v_tx,
      'customerTokenEmailNotificationAttempted',
      'customerReceiptEmailNotificationSent'
    );
  EXCEPTION WHEN invalid_parameter_value THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'EMAIL-PAIR-REGRESSION: mismatched claim (token attempt + receipt sent) did not raise';
  END IF;

  -- Case 3: matched claim (receipt pair) still succeeds and stamps.
  v_meta := public.claim_vtu_customer_email_notification_attempt(
    v_tx,
    'customerReceiptEmailNotificationAttempted',
    'customerReceiptEmailNotificationSent'
  );
  IF v_meta IS NULL OR (v_meta ->> 'customerReceiptEmailNotificationAttempted') <> 'true' THEN
    RAISE EXCEPTION 'EMAIL-PAIR-REGRESSION: matched receipt claim did not stamp the attempt flag';
  END IF;
  v_stamp := v_meta ->> 'customerReceiptEmailNotificationAttemptedAt';
  IF v_stamp IS NULL OR v_stamp = '' THEN
    RAISE EXCEPTION 'EMAIL-PAIR-REGRESSION: matched receipt claim did not stamp a lease generation';
  END IF;

  -- Case 4: mismatched clear raises even with a live lease.
  v_raised := false;
  BEGIN
    PERFORM public.clear_vtu_customer_email_notification_attempt(
      v_tx,
      'customerReceiptEmailNotificationAttempted',
      'customerTokenEmailNotificationSent',
      v_stamp
    );
  EXCEPTION WHEN invalid_parameter_value THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'EMAIL-PAIR-REGRESSION: mismatched clear did not raise';
  END IF;

  -- Case 5: matched clear releases the lease it stamped.
  v_meta := public.clear_vtu_customer_email_notification_attempt(
    v_tx,
    'customerReceiptEmailNotificationAttempted',
    'customerReceiptEmailNotificationSent',
    v_stamp
  );
  IF v_meta IS NULL OR (v_meta ->> 'customerReceiptEmailNotificationAttempted') <> 'false' THEN
    RAISE EXCEPTION 'EMAIL-PAIR-REGRESSION: matched receipt clear did not release the attempt flag';
  END IF;
END $$;

ROLLBACK;
