-- Behaviour of the chat webhook intake function. Runs in one transaction and
-- rolls back: it leaves no merchant, secret or notification behind.
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('c4a70000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-notify-owner@example.invalid');
-- Store rows are created the way trusted server code creates them.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug, country, payout_currency)
VALUES ('c4a70000-0000-4000-8000-0000000000b1', 'c4a70000-0000-4000-8000-0000000000a1', 'chat-notify-owner@example.invalid', 'Synthetic Chat Notify Store', 'synthetic-chat-notify', 'NG', 'NGN');
RESET ROLE;
SELECT set_config('request.jwt.claim.role', '', true);

CREATE FUNCTION pg_temp.chat_proof(p_secret text, p_issued_at bigint, p_merchant uuid, p_key text, p_conversation bigint, p_name text, p_preview text)
RETURNS text LANGUAGE sql AS $$
  SELECT encode(extensions.hmac(concat_ws('|', 'chat-customer-message:v1', p_issued_at::text, p_merchant::text, p_key, p_conversation::text,
    -- A missing name or preview is signed as the empty string.
    encode(extensions.digest(convert_to(btrim(COALESCE(p_name, '')), 'UTF8'), 'sha256'), 'hex'),
    encode(extensions.digest(convert_to(btrim(COALESCE(p_preview, '')), 'UTF8'), 'sha256'), 'hex')), p_secret, 'sha256'), 'hex');
$$;
CREATE FUNCTION pg_temp.send(p_key text, p_conversation bigint, p_name text DEFAULT 'Ada', p_preview text DEFAULT 'Is it in stock?', p_secret text DEFAULT 'synthetic-chat-event-secret-0123456789abcdef', p_age integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.record_chat_customer_message(
    pg_temp.chat_proof(p_secret, extract(epoch FROM now())::bigint - p_age, 'c4a70000-0000-4000-8000-0000000000b1', p_key, p_conversation, p_name, p_preview),
    extract(epoch FROM now())::bigint - p_age, 'c4a70000-0000-4000-8000-0000000000b1', p_key, p_conversation, p_name, p_preview);
$$;

-- Nothing works until a server secret is configured.
DELETE FROM private.chat_event_server_secrets;
DO $$ BEGIN
  BEGIN
    PERFORM pg_temp.send('evt-unconfigured', 1);
    RAISE EXCEPTION 'intake accepted an event with no configured secret';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;

INSERT INTO private.chat_event_server_secrets(secret_name, secret) VALUES ('current', 'synthetic-chat-event-secret-0123456789abcdef');

DO $$
DECLARE v jsonb; v_notification public.notifications; v_recipient public.merchant_notifications;
BEGIN
  -- A wrong secret, a stale proof and malformed input are all refused.
  BEGIN PERFORM pg_temp.send('evt-forged-1', 1, p_secret => 'another-secret-another-secret-another-0000'); RAISE EXCEPTION 'forged proof accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_invalid' THEN RAISE; END IF; END;
  BEGIN PERFORM pg_temp.send('evt-stale-01', 1, p_age => 301); RAISE EXCEPTION 'stale proof accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_expired' THEN RAISE; END IF; END;
  -- Only a small clock skew into the future is tolerated.
  BEGIN PERFORM pg_temp.send('evt-future-1', 1, p_age => -61); RAISE EXCEPTION 'future-dated proof accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_expired' THEN RAISE; END IF; END;
  BEGIN PERFORM pg_temp.send('bad key!', 1); RAISE EXCEPTION 'malformed event key accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM pg_temp.send('evt-too-long', 1, p_preview => repeat('x', 281)); RAISE EXCEPTION 'oversized preview accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.chat_message_events WHERE merchant_id = 'c4a70000-0000-4000-8000-0000000000b1') THEN RAISE EXCEPTION 'a refused event was recorded'; END IF;

  -- First customer message: one visible, sent, system notification for the owner's store.
  v := pg_temp.send('evt-0000001', 7);
  IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'first message: %', v; END IF;
  SELECT n.* INTO v_notification FROM public.notifications n JOIN public.chat_message_events e ON e.notification_id = n.id WHERE e.event_key = 'evt-0000001';
  IF v_notification.title <> 'New message from Ada' OR v_notification.message <> 'Is it in stock?'
    OR v_notification.notification_type <> 'info' OR v_notification.target_type <> 'specific'
    OR v_notification.target_merchant_ids <> ARRAY['c4a70000-0000-4000-8000-0000000000b1'::uuid]
    OR v_notification.created_by <> 'c4a70000-0000-4000-8000-0000000000a1' OR v_notification.is_system IS NOT TRUE
    OR v_notification.delivery_state <> 'sent' OR v_notification.sent_at IS NULL
    OR v_notification.action_url <> '/dashboard/messages' THEN
    RAISE EXCEPTION 'unexpected notification row: %', to_jsonb(v_notification);
  END IF;
  SELECT * INTO v_recipient FROM public.merchant_notifications WHERE notification_id = v_notification.id;
  IF v_recipient.merchant_id <> 'c4a70000-0000-4000-8000-0000000000b1' OR v_recipient.in_app_visible IS NOT TRUE OR v_recipient.banner_visible THEN
    RAISE EXCEPTION 'unexpected recipient row: %', to_jsonb(v_recipient);
  END IF;

  -- The same provider message delivered again changes nothing.
  v := pg_temp.send('evt-0000001', 7);
  IF v <> '{"outcome":"notified","duplicate":true}'::jsonb THEN RAISE EXCEPTION 'duplicate: %', v; END IF;

  -- More messages in the same unread chat do not pile up notifications...
  v := pg_temp.send('evt-0000002', 7, p_preview => 'Hello?');
  IF v <> '{"outcome":"coalesced"}'::jsonb THEN RAISE EXCEPTION 'burst: %', v; END IF;
  -- ...another chat still notifies...
  v := pg_temp.send('evt-0000003', 8, p_name => '', p_preview => '');
  IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'other chat: %', v; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications n JOIN public.chat_message_events e ON e.notification_id = n.id
    WHERE e.event_key = 'evt-0000003' AND n.title = 'New customer message' AND n.message = 'A customer sent a message to your store.') THEN
    RAISE EXCEPTION 'fallback wording missing';
  END IF;
  -- ...and once the merchant has read it, the next message notifies again.
  UPDATE public.merchant_notifications SET read_at = now() WHERE notification_id = v_notification.id;
  v := pg_temp.send('evt-0000004', 7);
  IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'after read: %', v; END IF;
  IF (SELECT count(*) FROM public.merchant_notifications WHERE merchant_id = 'c4a70000-0000-4000-8000-0000000000b1') <> 3 THEN
    RAISE EXCEPTION 'expected exactly three notifications';
  END IF;

  -- The merchant setting is honoured: off and handover-only both mute ordinary messages.
  INSERT INTO public.notification_preferences(merchant_id, chat_message_notifications) VALUES ('c4a70000-0000-4000-8000-0000000000b1', 'off')
  ON CONFLICT (merchant_id) DO UPDATE SET chat_message_notifications = 'off';
  v := pg_temp.send('evt-0000005', 9);
  IF v <> '{"outcome":"muted"}'::jsonb THEN RAISE EXCEPTION 'off: %', v; END IF;
  UPDATE public.notification_preferences SET chat_message_notifications = 'handover' WHERE merchant_id = 'c4a70000-0000-4000-8000-0000000000b1';
  v := pg_temp.send('evt-0000006', 9);
  IF v <> '{"outcome":"muted"}'::jsonb THEN RAISE EXCEPTION 'handover: %', v; END IF;
  -- In-app switched off keeps the record but hides it from the bell.
  UPDATE public.notification_preferences SET chat_message_notifications = 'all', in_app_enabled = false WHERE merchant_id = 'c4a70000-0000-4000-8000-0000000000b1';
  v := pg_temp.send('evt-0000007', 10);
  IF v <> '{"outcome":"notified"}'::jsonb OR EXISTS (
    SELECT 1 FROM public.merchant_notifications mn JOIN public.chat_message_events e ON e.notification_id = mn.notification_id
    WHERE e.event_key = 'evt-0000007' AND mn.in_app_visible) THEN
    RAISE EXCEPTION 'in-app preference ignored';
  END IF;
  -- A hidden notification must not swallow the next one once in-app is back on.
  UPDATE public.notification_preferences SET in_app_enabled = true WHERE merchant_id = 'c4a70000-0000-4000-8000-0000000000b1';
  v := pg_temp.send('evt-0000012', 10);
  IF v <> '{"outcome":"notified"}'::jsonb OR NOT EXISTS (
    SELECT 1 FROM public.merchant_notifications mn JOIN public.chat_message_events e ON e.notification_id = mn.notification_id
    WHERE e.event_key = 'evt-0000012' AND mn.in_app_visible) THEN
    RAISE EXCEPTION 'hidden notification suppressed a visible one: %', v;
  END IF;
  BEGIN
    UPDATE public.notification_preferences SET chat_message_notifications = 'sometimes' WHERE merchant_id = 'c4a70000-0000-4000-8000-0000000000b1';
    RAISE EXCEPTION 'unknown notification level accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- A missing name and preview are accepted and signed as empty strings.
DO $$ DECLARE v jsonb; BEGIN
  v := pg_temp.send('evt-null-0001', 14, p_name => NULL, p_preview => NULL);
  IF v <> '{"outcome":"notified"}'::jsonb OR NOT EXISTS (
    SELECT 1 FROM public.notifications n JOIN public.chat_message_events e ON e.notification_id = n.id
    WHERE e.event_key = 'evt-null-0001' AND n.title = 'New customer message') THEN
    RAISE EXCEPTION 'null name/preview: %', v;
  END IF;
END $$;

-- Hourly budget: a surge of separate chats stops creating notifications.
DO $$ DECLARE v jsonb; v_before integer; BEGIN
  SELECT count(*) INTO v_before FROM public.chat_message_events
    WHERE merchant_id = 'c4a70000-0000-4000-8000-0000000000b1' AND outcome = 'notified';
  FOR i IN 1..(60 - v_before) LOOP
    v := pg_temp.send('evt-surge-' || lpad(i::text, 4, '0'), 1000 + i);
    IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'surge % under budget: %', i, v; END IF;
  END LOOP;
  v := pg_temp.send('evt-surge-over', 5000);
  IF v <> '{"outcome":"coalesced"}'::jsonb THEN RAISE EXCEPTION 'over budget: %', v; END IF;
  IF (SELECT count(*) FROM public.chat_message_events
      WHERE merchant_id = 'c4a70000-0000-4000-8000-0000000000b1' AND outcome = 'notified') <> 60 THEN
    RAISE EXCEPTION 'budget not exact';
  END IF;
  -- Older notifications fall out of the hour and the budget opens again.
  UPDATE public.chat_message_events SET created_at = now() - interval '61 minutes'
    WHERE merchant_id = 'c4a70000-0000-4000-8000-0000000000b1';
  v := pg_temp.send('evt-surge-next', 5001);
  IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'after the hour: %', v; END IF;
END $$;

-- The previous secret keeps working during a rotation.
INSERT INTO private.chat_event_server_secrets(secret_name, secret) VALUES ('previous', 'older-synthetic-chat-event-secret-fedcba9876543210');
DO $$ DECLARE v jsonb; BEGIN
  v := pg_temp.send('evt-0000008', 11, p_secret => 'older-synthetic-chat-event-secret-fedcba9876543210');
  IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'previous secret: %', v; END IF;
END $$;

-- The public API role can call the function with a valid proof, and nothing
-- else. Proofs are prepared first: API roles cannot use this session's
-- temporary helpers.
SELECT set_config('test.issued_at', extract(epoch FROM now())::bigint::text, true);
SELECT set_config('test.proof_anon', pg_temp.chat_proof('synthetic-chat-event-secret-0123456789abcdef', current_setting('test.issued_at')::bigint, 'c4a70000-0000-4000-8000-0000000000b1', 'evt-0000009', 12, 'Ada', 'Hi'), true);
SELECT set_config('test.proof_user', pg_temp.chat_proof('synthetic-chat-event-secret-0123456789abcdef', current_setting('test.issued_at')::bigint, 'c4a70000-0000-4000-8000-0000000000b1', 'evt-0000010', 13, 'Ada', 'Hi'), true);
SET LOCAL ROLE anon;
DO $$ DECLARE v jsonb; BEGIN
  v := public.record_chat_customer_message(current_setting('test.proof_anon'), current_setting('test.issued_at')::bigint, 'c4a70000-0000-4000-8000-0000000000b1', 'evt-0000009', 12, 'Ada', 'Hi');
  IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'anon call: %', v; END IF;
  BEGIN PERFORM 1 FROM public.chat_message_events LIMIT 1; RAISE EXCEPTION 'anon read the event log';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM private.chat_event_server_secrets LIMIT 1; RAISE EXCEPTION 'anon read the secrets';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.chat_message_events(event_key, merchant_id, conversation_id, outcome) VALUES ('evt-direct-1', 'c4a70000-0000-4000-8000-0000000000b1', 1, 'notified'); RAISE EXCEPTION 'anon wrote the event log';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.record_chat_customer_message(current_setting('test.proof_user'), current_setting('test.issued_at')::bigint, 'c4a70000-0000-4000-8000-0000000000b1', 'evt-0000010', 13, 'Ada', 'Hi'); RAISE EXCEPTION 'a signed-in user could call the intake';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM LIKE 'chat_event%' THEN RAISE EXCEPTION 'signed-in call reached the function body'; END IF; END;
  BEGIN PERFORM 1 FROM public.chat_message_events LIMIT 1; RAISE EXCEPTION 'a signed-in user read the event log';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- Event keys are per store: another store using the same key is neither
-- blocked by, nor able to block, this store's event.
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('c4a70000-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-notify-second@example.invalid');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug, country, payout_currency)
VALUES ('c4a70000-0000-4000-8000-0000000000b2', 'c4a70000-0000-4000-8000-0000000000a2', 'chat-notify-second@example.invalid', 'Synthetic Chat Notify Store Two', 'synthetic-chat-notify-two', 'NG', 'NGN');
RESET ROLE;
SELECT set_config('request.jwt.claim.role', '', true);
DO $$ DECLARE v jsonb; v_at bigint := extract(epoch FROM now())::bigint; BEGIN
  v := public.record_chat_customer_message(
    pg_temp.chat_proof('synthetic-chat-event-secret-0123456789abcdef', v_at, 'c4a70000-0000-4000-8000-0000000000b2', 'evt-0000001', 7, 'Bola', 'Hi'),
    v_at, 'c4a70000-0000-4000-8000-0000000000b2', 'evt-0000001', 7, 'Bola', 'Hi');
  IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'same key, other store: %', v; END IF;
  IF (SELECT count(*) FROM public.chat_message_events WHERE event_key = 'evt-0000001') <> 2 THEN
    RAISE EXCEPTION 'per-store event keys not kept apart';
  END IF;
END $$;

-- An unknown store is ignored without recording anything.
DO $$ DECLARE v jsonb; v_at bigint := extract(epoch FROM now())::bigint; BEGIN
  v := public.record_chat_customer_message(
    pg_temp.chat_proof('synthetic-chat-event-secret-0123456789abcdef', v_at, 'c4a70000-0000-4000-8000-0000000000ff', 'evt-0000011', 1, 'Ada', 'Hi'),
    v_at, 'c4a70000-0000-4000-8000-0000000000ff', 'evt-0000011', 1, 'Ada', 'Hi');
  IF v <> '{"outcome":"ignored"}'::jsonb OR EXISTS (SELECT 1 FROM public.chat_message_events WHERE event_key = 'evt-0000011') THEN
    RAISE EXCEPTION 'unknown merchant: %', v;
  END IF;
END $$;

ROLLBACK;
