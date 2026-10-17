-- Codex R127 P2: finalize the VTU customer-email notification attempt.
--
-- On email failure/unknown the fulfillment path staged the outcome
-- (sent=false, plus the unknown marker) only in memory, then released
-- the lease with the fenced clear RPC. A crash between the clear and
-- the much-later settlement merge lost the outcome while freeing the
-- lease: a definite failure silently retried, and an unknown outcome
-- (ZeptoMail accepted, response lost) re-sent a maybe-delivered email.
-- The finalize RPC persists the outcome AND releases the lease in one
-- fenced UPDATE, under the same generation fence as the clear.
--
-- Scope: non-success outcomes only. The success path keeps staging
-- sent=true for the settlement merge (no RPC on the hot path; the
-- claim's sent<>true guard dominates the stale attempt flag), and the
-- thrown-send path keeps clear-only (a throw means never accepted, so
-- there is no outcome to persist).
--
-- Writes mirror setCustomerEmailNotificationResult
-- (apps/web/src/lib/vtu-fulfillment.ts) exactly: sent=false on the
-- pair's sent key plus the receipt legacy mirror, and the outcome key
-- ONLY for 'unknown' (definite failures stay retryable; the
-- unknown-exclusion readers match on value, not presence).
CREATE OR REPLACE FUNCTION public.finalize_vtu_customer_email_notification_attempt(
  p_transaction_id uuid,
  p_attempt_key text,
  p_sent_key text,
  p_attempt_at text,
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

  IF p_delivery_outcome NOT IN ('failed', 'unknown') THEN
    RAISE EXCEPTION 'Invalid VTU customer email delivery outcome'
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
      false
    )
    || CASE
      WHEN v_is_receipt THEN
        jsonb_build_object('customerEmailNotificationSent', false)
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

REVOKE ALL ON FUNCTION public.finalize_vtu_customer_email_notification_attempt(uuid, text, text, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.finalize_vtu_customer_email_notification_attempt(uuid, text, text, text, text)
TO service_role;
