-- Codex R97 P2: fence the VTU customer-email clear by the lease generation the
-- claim stamped. The R89 claim stamps `<attempt_key>At` atomically with the
-- flag, but clear released the flag unconditionally: a clear-side read taken
-- before the loser reclaimed the row could unlock the owner's fresh lease. The
-- caller now passes its stamped generation as p_attempt_at and the UPDATE only
-- matches when the row still carries that exact stamp; a reclaimed row (newer
-- stamp) matches nothing and returns NULL, so the stale clearer leaves the
-- owner's lease untouched instead of unlocking it early. The 3-arg signature is
-- dropped so old callers fail loudly (function not found) instead of clearing
-- ungated.
DROP FUNCTION IF EXISTS public.clear_vtu_customer_email_notification_attempt(uuid, text, text);

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
  v_allowed_attempt_keys constant text[] := ARRAY[
    'customerReceiptEmailNotificationAttempted',
    'customerTokenEmailNotificationAttempted'
  ];
  v_allowed_sent_keys constant text[] := ARRAY[
    'customerReceiptEmailNotificationSent',
    'customerTokenEmailNotificationSent'
  ];
  v_attempt_at_key text;
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
