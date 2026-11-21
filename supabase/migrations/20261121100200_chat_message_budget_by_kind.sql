-- The ordinary-message hourly cap counts ordinary messages only.
--
-- Handover alerts have their own hourly cap (record_chat_handover). Before
-- this, a handover row also counted against the message cap, so a burst of
-- handovers could coalesce the next ordinary customer message. The function is
-- unchanged apart from the added kind = 'message' filter in the budget count.
BEGIN;

CREATE OR REPLACE FUNCTION public.record_chat_customer_message(
  p_proof text,
  p_issued_at bigint,
  p_merchant_id uuid,
  p_event_key text,
  p_conversation_id bigint,
  p_customer_name text,
  p_preview text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_name text := pg_catalog.btrim(COALESCE(p_customer_name, ''));
  v_preview text := pg_catalog.btrim(COALESCE(p_preview, ''));
  v_canonical text;
  v_secret text;
  v_valid boolean := false;
  v_owner uuid;
  v_level text;
  v_in_app boolean;
  v_existing public.chat_message_events;
  v_outcome text;
  v_notification uuid;
BEGIN
  IF p_proof IS NULL OR p_proof !~ '^[0-9a-f]{64}$'
    OR p_issued_at IS NULL OR p_merchant_id IS NULL
    OR p_event_key IS NULL OR p_event_key !~ '^[A-Za-z0-9_-]{8,80}$'
    OR p_conversation_id IS NULL OR p_conversation_id <= 0
    OR char_length(v_name) > 80 OR char_length(v_preview) > 280 THEN
    RAISE EXCEPTION 'invalid_chat_event' USING ERRCODE = '22023';
  END IF;
  -- A proof is good for five minutes, with one minute allowed for a server
  -- clock running ahead of the database.
  IF extract(epoch FROM pg_catalog.now()) - p_issued_at > 300
    OR p_issued_at - extract(epoch FROM pg_catalog.now()) > 60 THEN
    RAISE EXCEPTION 'chat_event_proof_expired' USING ERRCODE = '42501';
  END IF;

  v_canonical := pg_catalog.concat_ws(
    '|', 'chat-customer-message:v1', p_issued_at::text, p_merchant_id::text,
    p_event_key, p_conversation_id::text,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_name, 'UTF8'), 'sha256'), 'hex'),
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_preview, 'UTF8'), 'sha256'), 'hex')
  );
  IF NOT EXISTS (SELECT 1 FROM private.chat_event_server_secrets) THEN
    RAISE EXCEPTION 'chat_event_secret_not_configured' USING ERRCODE = '55000';
  END IF;
  FOR v_secret IN SELECT secret FROM private.chat_event_server_secrets LOOP
    -- Compare digests of both sides so the comparison does not stop at the
    -- first differing character of the proof itself.
    IF extensions.digest(pg_catalog.encode(extensions.hmac(v_canonical, v_secret, 'sha256'), 'hex'), 'sha256')
      = extensions.digest(p_proof, 'sha256') THEN
      v_valid := true;
    END IF;
  END LOOP;
  IF NOT v_valid THEN
    RAISE EXCEPTION 'chat_event_proof_invalid' USING ERRCODE = '42501';
  END IF;

  SELECT m.user_id INTO v_owner FROM public.merchants m WHERE m.id = p_merchant_id;
  IF v_owner IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'ignored');
  END IF;

  -- Serialize one store's chat events: duplicate deliveries, bursts in one
  -- conversation and the hourly budget below are all decided one at a time.
  -- Event keys are unique per store, so the same key can only ever race under
  -- this one lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('chat-events:' || p_merchant_id::text, 0)
  );

  SELECT * INTO v_existing FROM public.chat_message_events
    WHERE merchant_id = p_merchant_id AND event_key = p_event_key;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('outcome', v_existing.outcome, 'duplicate', true);
  END IF;

  SELECT COALESCE(p.chat_message_notifications, 'all'), COALESCE(p.in_app_enabled, true)
    INTO v_level, v_in_app
    FROM public.notification_preferences p WHERE p.merchant_id = p_merchant_id;
  v_level := COALESCE(v_level, 'all');
  v_in_app := COALESCE(v_in_app, true);

  IF v_level <> 'all' THEN
    -- 'handover' only notifies on an assistant hand-over, which is a separate
    -- event; an ordinary customer message is muted at that level.
    v_outcome := 'muted';
  ELSIF EXISTS (
    SELECT 1
    FROM public.chat_message_events e
    JOIN public.merchant_notifications mn
      ON mn.notification_id = e.notification_id AND mn.merchant_id = e.merchant_id
    WHERE e.merchant_id = p_merchant_id
      AND e.conversation_id = p_conversation_id
      AND e.outcome = 'notified'
      AND e.created_at > pg_catalog.now() - interval '30 minutes'
      AND mn.in_app_visible
      AND mn.read_at IS NULL
      AND mn.dismissed_at IS NULL
  ) THEN
    -- The merchant already has a visible, unread notification for this chat.
    v_outcome := 'coalesced';
  ELSIF (
    SELECT count(*) FROM public.chat_message_events e
    WHERE e.merchant_id = p_merchant_id
      AND e.kind = 'message'
      AND e.outcome = 'notified'
      AND e.created_at > pg_catalog.now() - interval '1 hour'
  ) >= 60 THEN
    -- Hourly budget per store: a surge of separate chats, a misbehaving
    -- sender or a leaked proof secret cannot fill the merchant's bell without
    -- bound. The event is still recorded; the chats remain in the inbox.
    v_outcome := 'coalesced';
  ELSE
    INSERT INTO public.notifications(
      title, message, notification_type, priority, target_type, target_merchant_ids,
      channels, action_url, action_label, created_by, is_system, scheduled_for, sent_at, delivery_state
    ) VALUES (
      CASE WHEN v_name = '' THEN 'New customer message' ELSE 'New message from ' || v_name END,
      CASE WHEN v_preview = '' THEN 'A customer sent a message to your store.' ELSE v_preview END,
      'info', 'normal', 'specific', ARRAY[p_merchant_id],
      '["in_app"]'::jsonb, '/dashboard/messages', 'Open chat', v_owner, true,
      pg_catalog.now(), pg_catalog.now(), 'sent'
    ) RETURNING id INTO v_notification;
    INSERT INTO public.merchant_notifications(notification_id, merchant_id, in_app_visible, banner_visible)
    VALUES (v_notification, p_merchant_id, v_in_app, false)
    ON CONFLICT (notification_id, merchant_id) DO NOTHING;
    v_outcome := 'notified';
  END IF;

  INSERT INTO public.chat_message_events(event_key, merchant_id, conversation_id, outcome, notification_id)
  VALUES (p_event_key, p_merchant_id, p_conversation_id, v_outcome, v_notification);

  -- Bounded housekeeping: the duplicate guard only needs recent rows. A
  -- provider message redelivered after 30 days would be treated as new.
  DELETE FROM public.chat_message_events
  WHERE merchant_id = p_merchant_id AND event_key IN (
    SELECT event_key FROM public.chat_message_events
    WHERE merchant_id = p_merchant_id AND created_at < pg_catalog.now() - interval '30 days'
    LIMIT 200
  );

  RETURN pg_catalog.jsonb_build_object('outcome', v_outcome);
END;
$$;

COMMIT;
