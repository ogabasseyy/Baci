-- =============================================
-- REGRESSION TEST: VTU customer-email finalize RPC
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/vtu_customer_email_notification_finalize.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- Covers migrations 20261016120000 + 20261016123000 (Codex R127
-- P2): the finalize RPC must persist the send outcome AND release the
-- lease in one fenced UPDATE — never one without the other.
-- =============================================

BEGIN;

ALTER TABLE public.vtu_transactions DISABLE TRIGGER USER;
INSERT INTO public.vtu_transactions (
  id, merchant_id, customer_id, type, network_provider, phone_number,
  amount, request_reference, status, customer_identifier, metadata
)
VALUES
  ('01ac0000-0000-4000-8000-00000000ef10', '01ac0000-0000-4000-8000-00000000ab10',
    '01ac0000-0000-4000-8000-00000000ab20', 'airtime', 'mtn', '08012345678',
    100, 'VTU-EMAIL-FINALIZE-REGRESSION-1', 'pending', '1234567890',
    '{}'),
  ('01ac0000-0000-4000-8000-00000000ef20', '01ac0000-0000-4000-8000-00000000ab10',
    '01ac0000-0000-4000-8000-00000000ab20', 'electricity', '', '',
    1000, 'VTU-EMAIL-FINALIZE-REGRESSION-2', 'pending', '43901766923',
    '{}');
ALTER TABLE public.vtu_transactions ENABLE TRIGGER USER;

DO $$
DECLARE
  v_receipt uuid := '01ac0000-0000-4000-8000-00000000ef10';
  v_token uuid := '01ac0000-0000-4000-8000-00000000ef20';
  v_meta jsonb;
  v_stamp text;
  v_raised boolean;
BEGIN
  -- Case 1: mismatched pair raises.
  v_raised := false;
  BEGIN
    PERFORM public.finalize_vtu_customer_email_notification_attempt(
      v_receipt,
      'customerReceiptEmailNotificationAttempted',
      'customerTokenEmailNotificationSent',
      '2026-10-16T00:00:00.000Z',
      false,
      'failed'
    );
  EXCEPTION WHEN invalid_parameter_value THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: mismatched finalize did not raise';
  END IF;

  -- Case 2: sent/outcome mismatch raises in both directions.
  v_raised := false;
  BEGIN
    PERFORM public.finalize_vtu_customer_email_notification_attempt(
      v_receipt,
      'customerReceiptEmailNotificationAttempted',
      'customerReceiptEmailNotificationSent',
      '2026-10-16T00:00:00.000Z',
      true,
      'failed'
    );
  EXCEPTION WHEN invalid_parameter_value THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: sent=true/outcome=failed finalize did not raise';
  END IF;
  v_raised := false;
  BEGIN
    PERFORM public.finalize_vtu_customer_email_notification_attempt(
      v_receipt,
      'customerReceiptEmailNotificationAttempted',
      'customerReceiptEmailNotificationSent',
      '2026-10-16T00:00:00.000Z',
      false,
      'sent'
    );
  EXCEPTION WHEN invalid_parameter_value THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: sent=false/outcome=sent finalize did not raise';
  END IF;

  -- Case 3: receipt unknown persists outcome + legacy mirrors and
  -- releases the lease atomically.
  v_meta := public.claim_vtu_customer_email_notification_attempt(
    v_receipt,
    'customerReceiptEmailNotificationAttempted',
    'customerReceiptEmailNotificationSent'
  );
  v_stamp := v_meta ->> 'customerReceiptEmailNotificationAttemptedAt';
  v_meta := public.finalize_vtu_customer_email_notification_attempt(
    v_receipt,
    'customerReceiptEmailNotificationAttempted',
    'customerReceiptEmailNotificationSent',
    v_stamp,
    false,
    'unknown'
  );
  IF v_meta IS NULL THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: matched unknown finalize returned null';
  END IF;
  IF (v_meta ->> 'customerReceiptEmailNotificationAttempted') <> 'false' THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: finalize did not release the lease flag';
  END IF;
  IF (v_meta ->> 'customerReceiptEmailNotificationSent') <> 'false' THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: finalize did not persist sent=false';
  END IF;
  IF (v_meta ->> 'customerReceiptEmailNotificationSentDeliveryOutcome') <> 'unknown' THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: finalize did not persist the unknown marker';
  END IF;
  IF (v_meta ->> 'customerEmailNotificationSent') <> 'false' THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: finalize did not mirror the legacy sent flag';
  END IF;
  IF (v_meta ->> 'customerEmailNotificationSentDeliveryOutcome') <> 'unknown' THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: finalize did not mirror the legacy unknown marker';
  END IF;
  -- Lease freed: a fresh claim succeeds (sent=false keeps it retryable).
  v_meta := public.claim_vtu_customer_email_notification_attempt(
    v_receipt,
    'customerReceiptEmailNotificationAttempted',
    'customerReceiptEmailNotificationSent'
  );
  IF v_meta IS NULL THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: re-claim after finalize did not succeed';
  END IF;

  -- Case 4: wrong generation finalizes nothing and touches nothing.
  v_meta := public.claim_vtu_customer_email_notification_attempt(
    v_token,
    'customerTokenEmailNotificationAttempted',
    'customerTokenEmailNotificationSent'
  );
  v_stamp := v_meta ->> 'customerTokenEmailNotificationAttemptedAt';
  v_meta := public.finalize_vtu_customer_email_notification_attempt(
    v_token,
    'customerTokenEmailNotificationAttempted',
    'customerTokenEmailNotificationSent',
    '2000-01-01T00:00:00.000Z',
    false,
    'failed'
  );
  IF v_meta IS NOT NULL THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: stale-generation finalize did not return null';
  END IF;
  SELECT metadata INTO v_meta FROM public.vtu_transactions WHERE id = v_token;
  IF (v_meta ->> 'customerTokenEmailNotificationAttempted') <> 'true' THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: stale finalize touched the lease flag';
  END IF;
  IF v_meta ? 'customerTokenEmailNotificationSent' THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: stale finalize wrote a sent outcome';
  END IF;

  -- Case 5: token failed writes sent=false with NO outcome key
  -- (definite failures stay retryable, matching the TS stager).
  -- Reuses case 4's still-live lease: no re-claim possible while the
  -- first generation is held.
  v_meta := public.finalize_vtu_customer_email_notification_attempt(
    v_token,
    'customerTokenEmailNotificationAttempted',
    'customerTokenEmailNotificationSent',
    v_stamp,
    false,
    'failed'
  );
  IF v_meta IS NULL THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: matched failed finalize returned null';
  END IF;
  IF (v_meta ->> 'customerTokenEmailNotificationAttempted') <> 'false'
    OR (v_meta ->> 'customerTokenEmailNotificationSent') <> 'false' THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: failed finalize did not release with sent=false';
  END IF;
  IF v_meta ? 'customerTokenEmailNotificationSentDeliveryOutcome' THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: failed finalize wrote an outcome key';
  END IF;

  -- Case 6: success finalize persists sent=true with NO outcome key
  -- and the sent flag then blocks every re-claim (Codex R127 P2
  -- success half: no 15-minute re-send window after a crash).
  v_meta := public.claim_vtu_customer_email_notification_attempt(
    v_token,
    'customerTokenEmailNotificationAttempted',
    'customerTokenEmailNotificationSent'
  );
  IF v_meta IS NULL THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: re-claim before success finalize did not succeed';
  END IF;
  v_stamp := v_meta ->> 'customerTokenEmailNotificationAttemptedAt';
  v_meta := public.finalize_vtu_customer_email_notification_attempt(
    v_token,
    'customerTokenEmailNotificationAttempted',
    'customerTokenEmailNotificationSent',
    v_stamp,
    true,
    'sent'
  );
  IF v_meta IS NULL THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: matched success finalize returned null';
  END IF;
  IF (v_meta ->> 'customerTokenEmailNotificationAttempted') <> 'false'
    OR (v_meta ->> 'customerTokenEmailNotificationSent') <> 'true' THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: success finalize did not release with sent=true';
  END IF;
  IF v_meta ? 'customerTokenEmailNotificationSentDeliveryOutcome' THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: success finalize wrote an outcome key';
  END IF;
  v_meta := public.claim_vtu_customer_email_notification_attempt(
    v_token,
    'customerTokenEmailNotificationAttempted',
    'customerTokenEmailNotificationSent'
  );
  IF v_meta IS NOT NULL THEN
    RAISE EXCEPTION 'EMAIL-FINALIZE-REGRESSION: re-claim after success finalize was not refused';
  END IF;
END $$;

ROLLBACK;
