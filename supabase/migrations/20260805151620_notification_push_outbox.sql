-- Persist Expo dispatch state before the network call. Ambiguous dispatches are
-- intentionally not retried automatically: Expo has no exact-once guarantee.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_notification_push_outbox (
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  push_token text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatching', 'accepted', 'rejected', 'unknown')),
  claim_token uuid,
  provider_ticket_id text,
  error_code text,
  dispatched_at timestamptz,
  accepted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (notification_id, push_token)
);
ALTER TABLE public.admin_notification_push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_notification_push_outbox FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS admin_notification_push_outbox_state_idx
  ON public.admin_notification_push_outbox (notification_id, status);

CREATE FUNCTION public.reserve_notification_push_batch_v1(
  p_notification_id uuid, p_claim_token uuid, p_tokens text[]
)
RETURNS TABLE(push_token text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' OR p_claim_token IS NULL
    OR COALESCE(cardinality(p_tokens), 0) > 100 THEN
    RAISE EXCEPTION 'Invalid notification push reservation' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications AS n WHERE n.id = p_notification_id
    AND n.delivery_state = 'processing' AND n.sent_at IS NULL AND n.delivery_claim_token = p_claim_token) THEN
    RAISE EXCEPTION 'Notification claim is no longer active' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.admin_notification_push_outbox SET status = 'unknown', error_code = 'dispatch_outcome_unknown',
    updated_at = statement_timestamp()
  WHERE notification_id = p_notification_id AND status = 'dispatching'
    AND dispatched_at < statement_timestamp() - interval '15 minutes';
  INSERT INTO public.admin_notification_push_outbox (notification_id, push_token)
  SELECT p_notification_id, token FROM unnest(COALESCE(p_tokens, '{}'::text[])) AS item(token)
  ON CONFLICT DO NOTHING;
  RETURN QUERY
  UPDATE public.admin_notification_push_outbox AS outbox
  SET status = 'dispatching', claim_token = p_claim_token, dispatched_at = statement_timestamp(),
    updated_at = statement_timestamp(), error_code = NULL
  WHERE outbox.notification_id = p_notification_id AND outbox.status = 'pending'
    AND outbox.push_token = ANY(COALESCE(p_tokens, '{}'::text[]))
  RETURNING outbox.push_token;
END;
$$;

CREATE FUNCTION public.record_notification_push_acceptance_v1(
  p_notification_id uuid, p_claim_token uuid, p_tokens text[], p_ticket_ids text[]
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' OR p_claim_token IS NULL
    OR cardinality(p_tokens) IS DISTINCT FROM cardinality(p_ticket_ids) THEN
    RAISE EXCEPTION 'Invalid notification push acceptance' USING ERRCODE = '22023';
  END IF;
  UPDATE public.admin_notification_push_outbox AS outbox
  SET status = 'accepted', provider_ticket_id = item.ticket_id, accepted_at = statement_timestamp(),
    updated_at = statement_timestamp(), error_code = NULL
  FROM unnest(p_tokens, p_ticket_ids) AS item(push_token, ticket_id)
  WHERE outbox.notification_id = p_notification_id AND outbox.push_token = item.push_token
    AND outbox.status = 'dispatching' AND outbox.claim_token = p_claim_token;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE FUNCTION public.mark_notification_push_unknown_v1(
  p_notification_id uuid, p_claim_token uuid, p_tokens text[], p_error_code text
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Invalid notification push outcome' USING ERRCODE = '22023';
  END IF;
  UPDATE public.admin_notification_push_outbox SET status = 'unknown', error_code = LEFT(COALESCE(p_error_code, 'dispatch_outcome_unknown'), 80),
    updated_at = statement_timestamp()
  WHERE notification_id = p_notification_id AND claim_token = p_claim_token AND status = 'dispatching'
    AND push_token = ANY(COALESCE(p_tokens, '{}'::text[]));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE FUNCTION public.get_notification_push_outbox_summary_v1(p_notification_id uuid, p_claim_token uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Service role claim required' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT jsonb_build_object('pending', COUNT(*) FILTER (WHERE status = 'pending'),
    'dispatching', COUNT(*) FILTER (WHERE status = 'dispatching'),
    'rejected', COUNT(*) FILTER (WHERE status = 'rejected'),
    'unknown', COUNT(*) FILTER (WHERE status = 'unknown'))
    FROM public.admin_notification_push_outbox WHERE notification_id = p_notification_id);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_notification_push_batch_v1(uuid, uuid, text[]),
  public.record_notification_push_acceptance_v1(uuid, uuid, text[], text[]),
  public.mark_notification_push_unknown_v1(uuid, uuid, text[], text),
  public.get_notification_push_outbox_summary_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_notification_push_batch_v1(uuid, uuid, text[]),
  public.record_notification_push_acceptance_v1(uuid, uuid, text[], text[]),
  public.mark_notification_push_unknown_v1(uuid, uuid, text[], text),
  public.get_notification_push_outbox_summary_v1(uuid, uuid) TO service_role;

COMMIT;
