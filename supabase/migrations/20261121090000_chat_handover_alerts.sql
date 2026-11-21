-- Assistant handover alerts and the three-way chat alert level.
--
-- 1. When the assistant hands a chat to a person, the merchant is alerted
--    (bell notification, then a push) at the "all" and "handover only"
--    levels, and stays unalerted only when they chose "off". Before this, the
--    handover level muted ordinary customer messages and nothing ever told the
--    merchant about the handover itself.
-- 2. One setting, three plain choices, written through one permission-checked
--    function: all new messages / only when the assistant hands a chat to a
--    person / off. It also keeps the push switch from the earlier push
--    preference migration in step, so the two can never disagree.
--
-- The chat webhook has no user session, so the handover goes through one
-- narrow SECURITY DEFINER function with the same short-lived HMAC proof model
-- as record_chat_customer_message (same server-only secret, a different proof
-- label so neither proof can be replayed as the other).
BEGIN;

-- A row in the event log is either an ordinary customer message or an
-- assistant handover. Handovers use the same push claim as messages.
ALTER TABLE public.chat_message_events
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'message';

DO $chat_event_kind_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.chat_message_events'::regclass
      AND conname = 'chat_message_events_kind_check'
  ) THEN
    ALTER TABLE public.chat_message_events
      ADD CONSTRAINT chat_message_events_kind_check
      CHECK (kind IN ('message', 'handover'));
  END IF;
END;
$chat_event_kind_check$;

COMMENT ON COLUMN public.chat_message_events.kind IS
  'message = a customer message, handover = the assistant handed the chat to a person.';

-- A store that muted pushes with the earlier push-only switch asked for no
-- pushes; the single level must say so instead of showing "all" while pushes
-- stay off.
UPDATE public.notification_preferences
SET chat_message_notifications = 'off', updated_at = pg_catalog.now()
WHERE chat_message_push_enabled = false
  AND chat_message_notifications <> 'off';

-- Chat webhook intake for an assistant handover. Verifies the proof, applies
-- the merchant's level, removes duplicate deliveries and writes the
-- notification itself: the caller controls no notification column other than
-- a bounded customer name, and the wording is fixed here.
CREATE OR REPLACE FUNCTION public.record_chat_handover(
  p_proof text,
  p_issued_at bigint,
  p_merchant_id uuid,
  p_event_key text,
  p_conversation_id bigint,
  p_customer_name text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_name text := pg_catalog.btrim(COALESCE(p_customer_name, ''));
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
    OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'invalid_chat_event' USING ERRCODE = '22023';
  END IF;
  IF extract(epoch FROM pg_catalog.now()) - p_issued_at > 300
    OR p_issued_at - extract(epoch FROM pg_catalog.now()) > 60 THEN
    RAISE EXCEPTION 'chat_event_proof_expired' USING ERRCODE = '42501';
  END IF;

  v_canonical := pg_catalog.concat_ws(
    '|', 'chat-handover:v1', p_issued_at::text, p_merchant_id::text,
    p_event_key, p_conversation_id::text,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_name, 'UTF8'), 'sha256'), 'hex')
  );
  IF NOT EXISTS (SELECT 1 FROM private.chat_event_server_secrets) THEN
    RAISE EXCEPTION 'chat_event_secret_not_configured' USING ERRCODE = '55000';
  END IF;
  FOR v_secret IN SELECT secret FROM private.chat_event_server_secrets LOOP
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

  -- Same per-store lock as the customer-message intake, so a handover and a
  -- message for one store are decided one at a time.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('chat-events:' || p_merchant_id::text, 0)
  );

  SELECT * INTO v_existing FROM public.chat_message_events
    WHERE merchant_id = p_merchant_id AND event_key = p_event_key;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('outcome', v_existing.outcome, 'duplicate', true);
  END IF;

  -- No preference row, or an unreadable level, means the default: alert.
  SELECT COALESCE(p.chat_message_notifications, 'all'), COALESCE(p.in_app_enabled, true)
    INTO v_level, v_in_app
    FROM public.notification_preferences p WHERE p.merchant_id = p_merchant_id;
  v_level := COALESCE(v_level, 'all');
  v_in_app := COALESCE(v_in_app, true);

  IF v_level = 'off' THEN
    -- The only level that stays silent. "all" and "handover" both alert.
    v_outcome := 'muted';
  ELSIF (
    SELECT count(*) FROM public.chat_message_events e
    WHERE e.merchant_id = p_merchant_id
      AND e.kind = 'handover'
      AND e.outcome = 'notified'
      AND e.created_at > pg_catalog.now() - interval '1 hour'
  ) >= 60 THEN
    -- Hourly budget for handovers, counted apart from ordinary messages so a
    -- surge of messages never hides a handover. It only bounds abuse (a
    -- leaked proof secret); a real store is nowhere near it.
    v_outcome := 'coalesced';
  ELSE
    -- A handover is never folded into an earlier unread message alert: it is
    -- a different event ("the assistant gave up"), and it must be seen.
    INSERT INTO public.notifications(
      title, message, notification_type, priority, target_type, target_merchant_ids,
      channels, action_url, action_label, created_by, is_system, scheduled_for, sent_at, delivery_state
    ) VALUES (
      CASE WHEN v_name = '' THEN 'A customer needs a person' ELSE v_name || ' needs a person' END,
      'The assistant handed this chat to your team. Open it to reply.',
      'info', 'normal', 'specific', ARRAY[p_merchant_id],
      '["in_app"]'::jsonb, '/dashboard/messages', 'Open chat', v_owner, true,
      pg_catalog.now(), pg_catalog.now(), 'sent'
    ) RETURNING id INTO v_notification;
    INSERT INTO public.merchant_notifications(notification_id, merchant_id, in_app_visible, banner_visible)
    VALUES (v_notification, p_merchant_id, v_in_app, false)
    ON CONFLICT (notification_id, merchant_id) DO NOTHING;
    v_outcome := 'notified';
  END IF;

  INSERT INTO public.chat_message_events(event_key, merchant_id, conversation_id, outcome, notification_id, kind)
  VALUES (p_event_key, p_merchant_id, p_conversation_id, v_outcome, v_notification, 'handover');

  RETURN pg_catalog.jsonb_build_object('outcome', v_outcome);
END;
$$;

COMMENT ON FUNCTION public.record_chat_handover(text, bigint, uuid, text, bigint, text) IS
  'Chat webhook intake for an assistant handover: verifies a server HMAC proof, then alerts the merchant unless their chat alert level is off.';

-- Reachable without a session, but useless without a valid proof.
REVOKE ALL ON FUNCTION public.record_chat_handover(text, bigint, uuid, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_chat_handover(text, bigint, uuid, text, bigint, text) TO anon, service_role;

-- The push log keeps fixed wording (customer text never reaches it); a
-- handover gets its own fixed wording instead of "New customer message".
CREATE OR REPLACE FUNCTION public.chat_event_record_push_attempt(
  p_proof text, p_issued_at bigint, p_merchant_id uuid, p_event_key text, p_claim uuid, p_attempt jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_merchant uuid;
  v_handover boolean;
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
  SELECT e.kind = 'handover' INTO v_handover FROM public.chat_message_events e
    WHERE e.merchant_id = v_merchant AND e.event_key = p_event_key;
  INSERT INTO public.push_notification_attempts (
    merchant_id, user_id, app_type, channel, notification_type, title, body,
    payload, token_count, sent_count, failed_count, status, errors
  ) VALUES (
    v_merchant, NULL, 'admin', 'general', 'customer_message',
    CASE WHEN COALESCE(v_handover, false) THEN 'A customer needs a person' ELSE 'New customer message' END,
    CASE WHEN COALESCE(v_handover, false)
      THEN 'The assistant handed this chat to your team. Open it to reply.'
      ELSE 'A customer sent a message to your store.' END,
    pg_catalog.jsonb_build_object('type', 'customer_message', 'event_key', p_event_key),
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

-- Dashboard read: the merchant's current chat alert level. Owner or staff who
-- may view the dashboard; nobody else, so one store's setting is never
-- readable by another.
CREATE OR REPLACE FUNCTION public.get_chat_message_alert_level(
  p_merchant_id uuid
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
    AND NOT public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'dashboard', 'view'
    )
  THEN
    RAISE EXCEPTION 'not authorized to read notification preferences'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(
    (
      SELECT preference.chat_message_notifications
      FROM public.notification_preferences AS preference
      WHERE preference.merchant_id = p_merchant_id
    ),
    'all'
  );
END;
$$;

ALTER FUNCTION public.get_chat_message_alert_level(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_chat_message_alert_level(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chat_message_alert_level(uuid) TO authenticated, service_role;

-- Dashboard write: the owner or staff with settings.edit, nobody else. The
-- push switch follows the level (on unless "off"), so a choice made here is
-- never undone by an older push-only setting.
CREATE OR REPLACE FUNCTION public.set_chat_message_alert_level(
  p_merchant_id uuid,
  p_level text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_level IS NULL OR p_level NOT IN ('all', 'handover', 'off') THEN
    RAISE EXCEPTION 'level must be all, handover or off' USING ERRCODE = '22023';
  END IF;
  IF coalesce(auth.role(), '') <> 'service_role'
    AND NOT public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'settings', 'edit'
    )
  THEN
    RAISE EXCEPTION 'not authorized to edit notification preferences'
      USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.notification_preferences AS preferences (
    merchant_id, chat_message_notifications, chat_message_push_enabled, updated_at
  ) VALUES (p_merchant_id, p_level, p_level <> 'off', pg_catalog.now())
  ON CONFLICT (merchant_id) DO UPDATE
  SET chat_message_notifications = EXCLUDED.chat_message_notifications,
      chat_message_push_enabled = EXCLUDED.chat_message_push_enabled,
      updated_at = pg_catalog.now();
  RETURN p_level;
END;
$$;

ALTER FUNCTION public.set_chat_message_alert_level(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_chat_message_alert_level(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_chat_message_alert_level(uuid, text) TO authenticated, service_role;

COMMIT;
