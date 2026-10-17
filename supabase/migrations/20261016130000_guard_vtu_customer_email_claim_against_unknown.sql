-- Codex R128 P2: the claim RPC must reject the unknown outcome marker.
--
-- Finalize releases the lease with sent=false for unknown outcomes
-- (ZeptoMail accepted, response lost). The claim RPC fenced only on
-- the sent flag and the lease stamp — so a worker holding a
-- pre-finalize snapshot could pass the TypeScript unknown pre-check,
-- then claim AFTER another worker's unknown finalize landed, and
-- re-send a possibly-delivered email. The TypeScript pre-check is
-- TOCTOU by nature; the atomic claim is the backstop and now enforces
-- the terminal marker itself, per pair (a receipt unknown still does
-- not block the distinct token-ready claim — Codex R107 P2).
--
-- Same signature (CREATE OR REPLACE): only the fence gains the
-- outcome guard. Definite failures write no marker, so failed rows
-- stay retryable as before.
CREATE OR REPLACE FUNCTION public.claim_vtu_customer_email_notification_attempt(
  p_transaction_id uuid,
  p_attempt_key text,
  p_sent_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_attempt_at_key text;
  v_lease_cutoff text;
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

  v_attempt_at_key := p_attempt_key || 'At';
  v_outcome_key := p_sent_key || 'DeliveryOutcome';
  v_lease_cutoff := to_char(
    (now() - make_interval(mins => 15)) AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'
  );

  UPDATE public.vtu_transactions
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    p_attempt_key,
    true,
    v_attempt_at_key,
    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
  )
  WHERE id = p_transaction_id
    AND COALESCE(metadata ->> p_sent_key, 'false') <> 'true'
    AND COALESCE(metadata ->> v_outcome_key, '') <> 'unknown'
    AND (
      COALESCE(metadata ->> p_attempt_key, 'false') <> 'true'
      OR COALESCE(metadata ->> v_attempt_at_key, '') = ''
      OR (metadata ->> v_attempt_at_key) < v_lease_cutoff
    )
  RETURNING metadata INTO v_metadata;

  RETURN v_metadata;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_vtu_customer_email_notification_attempt(uuid, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.claim_vtu_customer_email_notification_attempt(uuid, text, text)
TO service_role;
