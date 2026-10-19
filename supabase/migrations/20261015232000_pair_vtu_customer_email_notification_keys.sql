-- Muse R108 LOW: pair-validate the VTU customer-email notification keys.
--
-- The R89 claim and R97 fenced clear validated the attempt and sent keys
-- independently (each key merely belonged to its own allow-list). A
-- mismatched call — receipt attempt key + token sent key, or vice versa —
-- therefore passed validation and then claimed/guarded against the WRONG
-- sent flag, potentially re-sending one email class or suppressing the
-- other. Current fulfillment callers pair them correctly and only
-- service_role can execute either RPC, so this was a latent contract bug,
-- not an externally exploitable hole — but the RPCs are the trust
-- boundary, so they now enforce the pairing themselves.
--
-- Both functions keep their signatures (CREATE OR REPLACE): only the
-- validation block changes. The two valid pairs mirror the paired states
-- in getCustomerEmailNotificationState (apps/web/src/lib/vtu-fulfillment.ts).
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

CREATE OR REPLACE FUNCTION public.clear_vtu_customer_email_notification_attempt(
  p_transaction_id uuid,
  p_attempt_key text,
  p_sent_key text,
  p_attempt_at text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_attempt_at_key text;
  v_metadata jsonb;
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

  UPDATE public.vtu_transactions
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    p_attempt_key,
    false
  )
  WHERE id = p_transaction_id
    AND COALESCE(metadata ->> p_sent_key, 'false') <> 'true'
    AND COALESCE(metadata ->> p_attempt_key, 'false') = 'true'
    AND COALESCE(metadata ->> v_attempt_at_key, '') = p_attempt_at
  RETURNING metadata INTO v_metadata;

  RETURN v_metadata;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_vtu_customer_email_notification_attempt(uuid, text, text, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.clear_vtu_customer_email_notification_attempt(uuid, text, text, text)
TO service_role;
