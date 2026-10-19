-- Codex R89 P2: lease the VTU customer-email claim.
--
-- The claim RPC set `<attempt_key> = true` with no timestamp, and both the
-- RPC guard and the TS pre-check refused any row with Attempted=true. A crash
-- between the claim and the send/clear (attempted write, ZeptoMail call, sent
-- write, or clear RPC) therefore wedged the row permanently: every later
-- claim refused it, and the R86 reconciler arm (sent `eq.false`) never
-- matched the unset sent key, so the receipt/token email was never retried.
--
-- The claim now stamps `<attempt_key>At` (ISO UTC, same shape as JS
-- toISOString, so lexicographic comparison is chronological) atomically with
-- the flag, and a claim whose stamp is older than 15 minutes — or missing,
-- which is exactly the pre-lease stuck population — is reclaimable. 15
-- minutes mirrors the baseline shipment-booking lock timeout and dwarfs send
-- latency (one ZeptoMail call): a live sender always holds a fresh lease
-- while a crashed one frees the row on the next cron tick. The TS pre-check
-- (isCustomerEmailClaimLeaseExpired) and the reconciler's stuck-claim arm
-- enforce the same lease; keep CUSTOMER_EMAIL_NOTIFICATION_CLAIM_LEASE_MS
-- in sync with the interval below.
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
  v_allowed_attempt_keys constant text[] := ARRAY[
    'customerReceiptEmailNotificationAttempted',
    'customerTokenEmailNotificationAttempted'
  ];
  v_allowed_sent_keys constant text[] := ARRAY[
    'customerReceiptEmailNotificationSent',
    'customerTokenEmailNotificationSent'
  ];
  v_attempt_at_key text;
  v_lease_cutoff text;
  v_metadata jsonb;
BEGIN
  IF NOT (
    p_attempt_key = ANY(v_allowed_attempt_keys)
    AND p_sent_key = ANY(v_allowed_sent_keys)
  ) THEN
    RAISE EXCEPTION 'Unsupported VTU customer email metadata key'
      USING ERRCODE = '22023';
  END IF;

  v_attempt_at_key := p_attempt_key || 'At';
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
