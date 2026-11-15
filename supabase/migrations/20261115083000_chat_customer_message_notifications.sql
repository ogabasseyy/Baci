-- Merchant notifications for customer chat messages.
--
-- The chat webhook has no user session, so it cannot write the platform
-- notification tables directly and must not use a service-role client. It
-- calls one narrow SECURITY DEFINER function with a short-lived HMAC proof
-- made from a server-only secret (same model as the quiz route proofs). The
-- function derives the owner, applies the merchant's preference, removes
-- duplicate deliveries and writes the notification rows itself: the caller
-- controls no notification column other than a bounded name and preview.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

-- Per-merchant level: every customer message, only a hand-over from the
-- assistant (reserved for the assistant integration), or nothing.
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS chat_message_notifications text NOT NULL DEFAULT 'all';

DO $chat_preference_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.notification_preferences'::regclass
      AND conname = 'notification_preferences_chat_message_notifications_check'
  ) THEN
    ALTER TABLE public.notification_preferences
      ADD CONSTRAINT notification_preferences_chat_message_notifications_check
      CHECK (chat_message_notifications IN ('all', 'handover', 'off'));
  END IF;
END;
$chat_preference_check$;

COMMENT ON COLUMN public.notification_preferences.chat_message_notifications IS
  'Customer chat notifications: all = every customer message, handover = only when the assistant hands a chat to the merchant, off = none.';

-- Server-only proof secrets. Never exposed through the API schema. The
-- secret is platform-wide (it authenticates Baci's own server, not a store);
-- per-store separation comes from the store id bound into every proof and
-- from the per-store webhook signing secret checked before a proof is made.
CREATE TABLE IF NOT EXISTS private.chat_event_server_secrets (
  secret_name text PRIMARY KEY CHECK (secret_name IN ('current', 'previous')),
  secret text NOT NULL CHECK (char_length(secret) BETWEEN 32 AND 256),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.chat_event_server_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.chat_event_server_secrets FROM PUBLIC, anon, authenticated;

-- One row per provider message per store: the duplicate guard and the audit
-- trail of what was done with it. No message text is stored here. Keys are
-- unique within a store only, so one store's keys can never collide with,
-- or pre-occupy, another store's.
CREATE TABLE IF NOT EXISTS public.chat_message_events (
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  event_key text NOT NULL CHECK (event_key ~ '^[A-Za-z0-9_-]{8,80}$'),
  conversation_id bigint NOT NULL CHECK (conversation_id > 0),
  outcome text NOT NULL CHECK (outcome IN ('notified', 'coalesced', 'muted')),
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, event_key)
);
CREATE INDEX IF NOT EXISTS chat_message_events_conversation_idx
  ON public.chat_message_events (merchant_id, conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_message_events_notification_idx
  ON public.chat_message_events (notification_id) WHERE notification_id IS NOT NULL;
ALTER TABLE public.chat_message_events ENABLE ROW LEVEL SECURITY;
-- No policies and no grants: only the definer function below touches it.
REVOKE ALL ON TABLE public.chat_message_events FROM PUBLIC, anon, authenticated;

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

COMMENT ON FUNCTION public.record_chat_customer_message(text, bigint, uuid, text, bigint, text, text) IS
  'Chat webhook intake: verifies a server HMAC proof, then creates at most one unread merchant notification per conversation according to the merchant preference.';

-- Reachable without a session, but useless without a valid proof.
REVOKE ALL ON FUNCTION public.record_chat_customer_message(text, bigint, uuid, text, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_chat_customer_message(text, bigint, uuid, text, bigint, text, text) TO anon, service_role;

COMMIT;
