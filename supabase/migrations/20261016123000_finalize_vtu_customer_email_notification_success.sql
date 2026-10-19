-- Codex R127 P2 (success half): the first finalize revision covered
-- failure/unknown only, but the finding explicitly includes the
-- success path — a worker that crashes after ZeptoMail accepts and
-- before the settlement merge leaves sent=true staged only in memory
-- with the lease still held; after 15-minute expiry another worker
-- re-claims and re-sends the receipt/token email. The finalize RPC now
-- takes the sent value too, so all three outcomes persist with the
-- lease release in one fenced UPDATE.
--
-- The 5-arg revision is dropped so old callers fail loudly (function
-- not found) instead of finalizing without a sent value. The outcome
-- key is still written ONLY for 'unknown', matching
-- setCustomerEmailNotificationResult exactly.
DROP FUNCTION IF EXISTS public.finalize_vtu_customer_email_notification_attempt(uuid, text, text, text, text);

CREATE OR REPLACE FUNCTION public.finalize_vtu_customer_email_notification_attempt(
  p_transaction_id uuid,
  p_attempt_key text,
  p_sent_key text,
  p_attempt_at text,
  p_sent boolean,
  p_delivery_outcome text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_attempt_at_key text;
  v_is_receipt boolean;
  v_metadata jsonb;
  v_outcome_key text;
BEGIN
  IF NOT (
    (
      p_attempt_key = 'customerReceiptEmailNotificationAttempted'
      AND p_sent_key = 'customerReceiptEmailNotificationSent'
    )
    OR (
      p_attempt_key = 'customerTokenEmailNotificationAttempted'
      AND p_sent_key = 'customerTokenEmailNotificationSent'
    )
  ) THEN
    RAISE EXCEPTION 'Mismatched VTU customer email metadata key pair'
      USING ERRCODE = '22023';
  END IF;

  IF p_delivery_outcome NOT IN ('sent', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'Invalid VTU customer email delivery outcome'
      USING ERRCODE = '22023';
  END IF;

  IF p_sent <> (p_delivery_outcome = 'sent') THEN
    RAISE EXCEPTION 'Mismatched VTU customer email finalize outcome'
      USING ERRCODE = '22023';
  END IF;

  v_attempt_at_key := p_attempt_key || 'At';
  v_outcome_key := p_sent_key || 'DeliveryOutcome';
  v_is_receipt :=
    p_sent_key = 'customerReceiptEmailNotificationSent';

  UPDATE public.vtu_transactions
  SET metadata = COALESCE(metadata, '{}'::jsonb)
    || jsonb_build_object(
      p_attempt_key,
      false,
      p_sent_key,
      p_sent
    )
    || CASE
      WHEN v_is_receipt THEN
        jsonb_build_object('customerEmailNotificationSent', p_sent)
      ELSE '{}'::jsonb
    END
    || CASE
      WHEN p_delivery_outcome = 'unknown' THEN
        jsonb_build_object(v_outcome_key, 'unknown')
        || CASE
          WHEN v_is_receipt THEN
            jsonb_build_object(
              'customerEmailNotificationSentDeliveryOutcome',
              'unknown'
            )
          ELSE '{}'::jsonb
        END
      ELSE '{}'::jsonb
    END
  WHERE id = p_transaction_id
    AND COALESCE(metadata ->> p_sent_key, 'false') <> 'true'
    AND COALESCE(metadata ->> p_attempt_key, 'false') = 'true'
    AND COALESCE(metadata ->> v_attempt_at_key, '') = p_attempt_at
  RETURNING metadata INTO v_metadata;

  RETURN v_metadata;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_vtu_customer_email_notification_attempt(uuid, text, text, text, boolean, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.finalize_vtu_customer_email_notification_attempt(uuid, text, text, text, boolean, text)
TO service_role;
