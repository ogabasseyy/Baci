-- Follow-up reminder push log wording (part 3 of 3).
--
-- The push log keeps fixed wording (customer text and names never reach it); a
-- reminder gets its own fixed wording next to the message and handover ones.
-- chat_event_record_push_attempt is unchanged apart from the follow_up case,
-- so supabase/tests/chat_customer_message_push.sql and
-- supabase/tests/chat_handover_alerts.sql still apply to it.
BEGIN;

CREATE OR REPLACE FUNCTION public.chat_event_record_push_attempt(
  p_proof text, p_issued_at bigint, p_merchant_id uuid, p_event_key text, p_claim uuid, p_attempt jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_merchant uuid;
  v_kind text;
BEGIN
  v_merchant := private.chat_event_push_lease(p_proof, p_issued_at, p_merchant_id, p_event_key, p_claim, 'attempt');
  IF v_merchant IS NULL THEN RETURN false; END IF;
  IF p_attempt IS NULL OR pg_catalog.jsonb_typeof(p_attempt) IS DISTINCT FROM 'object'
    OR (p_attempt ->> 'status') IS NULL
    OR (p_attempt ->> 'status') NOT IN ('sent', 'partial_failure', 'failed', 'skipped_no_tokens')
    -- Counts must be small non-negative whole numbers before they are cast.
    OR COALESCE(p_attempt ->> 'token_count', '0') !~ '^[0-9]{1,6}$'
    OR COALESCE(p_attempt ->> 'sent_count', '0') !~ '^[0-9]{1,6}$'
    OR COALESCE(p_attempt ->> 'failed_count', '0') !~ '^[0-9]{1,6}$' THEN
    RAISE EXCEPTION 'invalid_chat_push_request' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(e.kind, 'message') INTO v_kind FROM public.chat_message_events e
    WHERE e.merchant_id = v_merchant AND e.event_key = p_event_key;
  v_kind := COALESCE(v_kind, 'message');
  INSERT INTO public.push_notification_attempts (
    merchant_id, user_id, app_type, channel, notification_type, title, body,
    payload, token_count, sent_count, failed_count, status, errors
  ) VALUES (
    v_merchant, NULL, 'admin', 'general', 'customer_message',
    CASE v_kind
      WHEN 'handover' THEN 'A customer needs a person'
      WHEN 'follow_up' THEN 'Time to follow up'
      ELSE 'New customer message' END,
    CASE v_kind
      WHEN 'handover' THEN 'The assistant handed this chat to your team. Open it to reply.'
      WHEN 'follow_up' THEN 'This chat is due for a follow-up. Open it to reply.'
      ELSE 'A customer sent a message to your store.' END,
    pg_catalog.jsonb_build_object(
      'type', 'customer_message', 'event_key', p_event_key, 'handover', v_kind = 'handover'
    ) || CASE WHEN v_kind = 'follow_up' THEN pg_catalog.jsonb_build_object('follow_up', true) ELSE '{}'::jsonb END,
    GREATEST(COALESCE((p_attempt ->> 'token_count')::integer, 0), 0),
    GREATEST(COALESCE((p_attempt ->> 'sent_count')::integer, 0), 0),
    GREATEST(COALESCE((p_attempt ->> 'failed_count')::integer, 0), 0),
    p_attempt ->> 'status',
    CASE WHEN pg_catalog.jsonb_typeof(p_attempt -> 'errors') = 'array'
      THEN p_attempt -> 'errors' ELSE '[]'::jsonb END
  );
  RETURN true;
END;
$$;

COMMIT;
