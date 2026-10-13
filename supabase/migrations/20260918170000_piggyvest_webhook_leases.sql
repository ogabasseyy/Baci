ALTER TABLE public.piggyvest_webhook_inbox
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

UPDATE public.piggyvest_webhook_inbox
SET lease_expires_at = clock_timestamp() + interval '2 minutes'
WHERE status = 'processing' AND lease_expires_at IS NULL;

CREATE OR REPLACE FUNCTION public.claim_piggyvest_webhook_event(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  inbox_status text;
  inbox_expiry timestamptz;
  inbox_updated_at timestamptz;
  claim_time timestamptz;
  new_token uuid;
BEGIN
  IF p_event_id IS NULL OR length(p_event_id) = 0 THEN
    RAISE EXCEPTION 'Invalid event identity' USING ERRCODE = '22023';
  END IF;
  SELECT status, lease_expires_at, updated_at
  INTO inbox_status, inbox_expiry, inbox_updated_at
  FROM public.piggyvest_webhook_inbox
  WHERE event_id = p_event_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Webhook inbox event missing' USING ERRCODE = 'P0002';
  END IF;
  claim_time := clock_timestamp();
  IF inbox_status = 'processed' THEN
    RETURN jsonb_build_object('outcome', 'processed', 'claim_token', NULL);
  END IF;
  IF inbox_status = 'processing'
    AND COALESCE(inbox_expiry, inbox_updated_at + interval '2 minutes') > claim_time THEN
    RETURN jsonb_build_object('outcome', 'busy', 'claim_token', NULL);
  END IF;
  new_token := gen_random_uuid();
  UPDATE public.piggyvest_webhook_inbox
  SET status = 'processing', claim_token = new_token,
      lease_expires_at = claim_time + interval '2 minutes',
      attempts = attempts + 1, updated_at = claim_time,
      processed_at = NULL, last_error = NULL
  WHERE event_id = p_event_id;
  RETURN jsonb_build_object('outcome', 'claimed', 'claim_token', new_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_piggyvest_webhook_event(
  p_event_id text, p_claim_token uuid, p_status text, p_last_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  resolve_time timestamptz;
  resolved_count integer;
BEGIN
  IF p_event_id IS NULL OR length(p_event_id) = 0 OR p_claim_token IS NULL
    OR p_status IS NULL OR p_status NOT IN ('processed', 'failed')
    OR length(p_last_error) > 500 THEN
    RAISE EXCEPTION 'Invalid webhook resolution' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.piggyvest_webhook_inbox
  WHERE event_id = p_event_id FOR UPDATE;
  resolve_time := clock_timestamp();
  UPDATE public.piggyvest_webhook_inbox
  SET status = p_status, last_error = p_last_error,
      processed_at = CASE WHEN p_status = 'processed' THEN resolve_time ELSE NULL END,
      updated_at = resolve_time, claim_token = NULL, lease_expires_at = NULL
  WHERE event_id = p_event_id AND status = 'processing'
    AND claim_token = p_claim_token AND lease_expires_at > resolve_time;
  GET DIAGNOSTICS resolved_count = ROW_COUNT;
  RETURN resolved_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_piggyvest_webhook_event(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_piggyvest_webhook_event(text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_piggyvest_webhook_event(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_piggyvest_webhook_event(text, uuid, text, text) TO service_role;

REVOKE ALL ON TABLE public.piggyvest_webhook_inbox FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.piggyvest_webhook_inbox TO service_role;
GRANT INSERT (event_id, event_type, event_category, customer_id, wallet_id, reference, amount_kobo, status)
  ON public.piggyvest_webhook_inbox TO service_role;
GRANT UPDATE (status, claim_token, lease_expires_at, attempts, updated_at, processed_at, last_error)
  ON public.piggyvest_webhook_inbox TO service_role;
