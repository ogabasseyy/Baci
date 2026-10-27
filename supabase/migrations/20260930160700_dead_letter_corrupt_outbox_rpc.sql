-- Scoped dead-letter transition for corrupt manual outbox rows (PR 3580):
-- the cron worker previously terminalized unparseable rows through a
-- generic service-role table UPDATE. The repo critical rules forbid generic
-- service-role table access outside branded RPCs, so the transition lives
-- here: keyed by outbox id + worker id, manual event types only, and only
-- this worker's claimed processing rows. Returns true when exactly one row
-- terminalizes, false otherwise (the worker logs both outcomes as before).
CREATE OR REPLACE FUNCTION private.dead_letter_corrupt_outbox_row(
  p_outbox_id uuid,
  p_worker_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_type text;
  v_merchant_id uuid;
  v_order_id uuid;
  v_rows integer;
BEGIN
  IF p_outbox_id IS NULL OR p_worker_id IS NULL OR btrim(p_worker_id) = '' THEN
    RETURN false;
  END IF;

  -- Verify the stored identities before terminalizing: the claim
  -- projection may transiently drop fields during a producer/worker
  -- rollout while the stored row is intact, and terminalizing then would
  -- silently lose a document no later edit re-arms.
  SELECT n.event_type, n.merchant_id, n.order_id
  INTO v_event_type, v_merchant_id, v_order_id
  FROM public.order_notification_outbox AS n
  WHERE n.id = p_outbox_id
    AND n.locked_by = p_worker_id
    AND n.status = 'processing';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_event_type NOT IN ('manual_order_receipt', 'manual_order_invoice') THEN
    RETURN false;
  END IF;

  IF v_merchant_id IS NOT NULL AND v_order_id IS NOT NULL THEN
    RETURN false;
  END IF;

  UPDATE public.order_notification_outbox AS n
  SET dispatch_started_at = NULL,
    last_error = 'unparseable_outbox_row',
    locked_at = NULL,
    locked_by = NULL,
    next_attempt_at = NULL,
    skip_reason = 'unparseable',
    skipped_at = now(),
    status = 'skipped',
    updated_at = now()
  WHERE n.id = p_outbox_id
    AND n.locked_by = p_worker_id
    AND n.status = 'processing';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION private.dead_letter_corrupt_outbox_row(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.dead_letter_corrupt_outbox_row(uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.dead_letter_corrupt_outbox_row(
  p_outbox_id uuid,
  p_worker_id text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT private.dead_letter_corrupt_outbox_row(p_outbox_id, p_worker_id); $$;

REVOKE ALL ON FUNCTION public.dead_letter_corrupt_outbox_row(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dead_letter_corrupt_outbox_row(uuid, text)
  TO service_role;
