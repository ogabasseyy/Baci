-- Behaviour of the assistant handover alert and the chat alert level. Runs in
-- one transaction and rolls back: it leaves no merchant, secret, staff member
-- or notification behind.
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('c4a72000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-handover-owner@example.invalid'),
  ('c4a72000-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-handover-outsider@example.invalid'),
  ('c4a72000-0000-4000-8000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-handover-staff-allowed@example.invalid'),
  ('c4a72000-0000-4000-8000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-handover-staff-denied@example.invalid');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug, country, payout_currency)
VALUES ('c4a72000-0000-4000-8000-0000000000b1', 'c4a72000-0000-4000-8000-0000000000a1', 'chat-handover-owner@example.invalid', 'Synthetic Chat Handover Store', 'synthetic-chat-handover', 'NG', 'NGN');
INSERT INTO public.staff_members (merchant_id, user_id, email, role, permissions, status) VALUES
  ('c4a72000-0000-4000-8000-0000000000b1', 'c4a72000-0000-4000-8000-0000000000a3', 'chat-handover-staff-allowed@example.invalid', 'blog_manager', '{"settings":{"edit":true},"dashboard":{"view":true}}'::jsonb, 'active'),
  ('c4a72000-0000-4000-8000-0000000000b1', 'c4a72000-0000-4000-8000-0000000000a4', 'chat-handover-staff-denied@example.invalid', 'blog_manager', '{"settings":{"edit":false},"dashboard":{"view":false}}'::jsonb, 'active');
RESET ROLE;
SELECT set_config('request.jwt.claim.role', '', true);

CREATE FUNCTION pg_temp.handover_proof(p_secret text, p_issued_at bigint, p_merchant uuid, p_key text, p_conversation bigint, p_name text)
RETURNS text LANGUAGE sql AS $$
  SELECT encode(extensions.hmac(concat_ws('|', 'chat-handover:v1', p_issued_at::text, p_merchant::text, p_key, p_conversation::text,
    encode(extensions.digest(convert_to(btrim(COALESCE(p_name, '')), 'UTF8'), 'sha256'), 'hex')), p_secret, 'sha256'), 'hex');
$$;
CREATE FUNCTION pg_temp.handover(p_key text, p_conversation bigint, p_name text DEFAULT 'Ada', p_secret text DEFAULT 'synthetic-chat-event-secret-0123456789abcdef', p_age integer DEFAULT 0, p_merchant uuid DEFAULT 'c4a72000-0000-4000-8000-0000000000b1')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.record_chat_handover(pg_temp.handover_proof(p_secret, extract(epoch FROM now())::bigint - p_age, p_merchant, p_key, p_conversation, p_name),
    extract(epoch FROM now())::bigint - p_age, p_merchant, p_key, p_conversation, p_name);
$$;
CREATE FUNCTION pg_temp.message(p_key text, p_conversation bigint) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.record_chat_customer_message(
    encode(extensions.hmac(concat_ws('|', 'chat-customer-message:v1', extract(epoch FROM now())::bigint::text, 'c4a72000-0000-4000-8000-0000000000b1', p_key, p_conversation::text,
      encode(extensions.digest(convert_to('Ada', 'UTF8'), 'sha256'), 'hex'), encode(extensions.digest(convert_to('Hi', 'UTF8'), 'sha256'), 'hex')),
      'synthetic-chat-event-secret-0123456789abcdef', 'sha256'), 'hex'),
    extract(epoch FROM now())::bigint, 'c4a72000-0000-4000-8000-0000000000b1', p_key, p_conversation, 'Ada', 'Hi');
$$;

DELETE FROM private.chat_event_server_secrets;
INSERT INTO private.chat_event_server_secrets(secret_name, secret) VALUES ('current', 'synthetic-chat-event-secret-0123456789abcdef');

-- An ordinary message must be recorded as a message by its own statement, not by the
-- column default: with the default flipped, it still lands in the message budget.
ALTER TABLE public.chat_message_events ALTER COLUMN kind SET DEFAULT 'handover';
SELECT pg_temp.message('evt-hand-explicit', 91);
DO $$
BEGIN
  IF (SELECT kind FROM public.chat_message_events WHERE event_key = 'evt-hand-explicit') IS DISTINCT FROM 'message' THEN
    RAISE EXCEPTION 'message insert relies on the kind column default';
  END IF;
END $$;
ALTER TABLE public.chat_message_events ALTER COLUMN kind SET DEFAULT 'message';
DELETE FROM public.merchant_notifications WHERE notification_id IN (SELECT notification_id FROM public.chat_message_events WHERE event_key = 'evt-hand-explicit');
DELETE FROM public.chat_message_events WHERE event_key = 'evt-hand-explicit';

DO $$
DECLARE v jsonb; v_n public.notifications; v_r public.merchant_notifications;
BEGIN
  -- The vector the Node proof builder is tested against.
  IF pg_temp.handover_proof('synthetic-chat-event-secret-0123456789abcdef', 1794730000, 'c4a70000-0000-4000-8000-0000000000b1', 'chat-handover-2-128', 21, 'Ada')
    <> 'bb269241f1026d0c2302a4a9a2eb61134f35da312ca77b5e3c8b9122b377a566' THEN RAISE EXCEPTION 'proof vector drifted from the Node builder'; END IF;

  -- Forged, stale, future-dated, malformed and replayed proofs are refused and record nothing.
  BEGIN PERFORM pg_temp.handover('evt-hand-forged', 1, p_secret => 'another-secret-another-secret-another-0000'); RAISE EXCEPTION 'forged proof accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_invalid' THEN RAISE; END IF; END;
  BEGIN PERFORM pg_temp.handover('evt-hand-stale1', 1, p_age => 301); RAISE EXCEPTION 'stale proof accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_expired' THEN RAISE; END IF; END;
  BEGIN PERFORM pg_temp.handover('evt-hand-future', 1, p_age => -61); RAISE EXCEPTION 'future-dated proof accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_expired' THEN RAISE; END IF; END;
  BEGIN PERFORM pg_temp.handover('bad key!', 1); RAISE EXCEPTION 'malformed event key accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM pg_temp.handover('evt-hand-longname', 1, p_name => repeat('x', 81)); RAISE EXCEPTION 'oversized name accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  -- A customer-message proof is not a handover proof, and the reverse.
  BEGIN PERFORM public.record_chat_handover(
      encode(extensions.hmac(concat_ws('|', 'chat-customer-message:v1', extract(epoch FROM now())::bigint::text, 'c4a72000-0000-4000-8000-0000000000b1', 'evt-hand-replay', '1',
        encode(extensions.digest(convert_to('Ada', 'UTF8'), 'sha256'), 'hex'), encode(extensions.digest(convert_to('', 'UTF8'), 'sha256'), 'hex')),
        'synthetic-chat-event-secret-0123456789abcdef', 'sha256'), 'hex'),
      extract(epoch FROM now())::bigint, 'c4a72000-0000-4000-8000-0000000000b1', 'evt-hand-replay', 1, 'Ada');
    RAISE EXCEPTION 'a message proof was accepted as a handover proof';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_invalid' THEN RAISE; END IF; END;
  IF EXISTS (SELECT 1 FROM public.chat_message_events WHERE merchant_id = 'c4a72000-0000-4000-8000-0000000000b1') THEN RAISE EXCEPTION 'a refused event was recorded'; END IF;

  -- Default level (no preference row): the handover alerts, with fixed wording.
  v := pg_temp.handover('evt-hand-0001', 7);
  IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'first handover: %', v; END IF;
  SELECT n.* INTO v_n FROM public.notifications n JOIN public.chat_message_events e ON e.notification_id = n.id WHERE e.event_key = 'evt-hand-0001';
  IF v_n.title <> 'Ada needs a person' OR v_n.message <> 'The assistant handed this chat to your team. Open it to reply.'
    OR v_n.notification_type <> 'info' OR v_n.target_type <> 'specific'
    OR v_n.target_merchant_ids <> ARRAY['c4a72000-0000-4000-8000-0000000000b1'::uuid]
    OR v_n.created_by <> 'c4a72000-0000-4000-8000-0000000000a1' OR v_n.is_system IS NOT TRUE
    OR v_n.delivery_state <> 'sent' OR v_n.action_url <> '/dashboard/messages' THEN
    RAISE EXCEPTION 'unexpected handover notification: %', to_jsonb(v_n);
  END IF;
  SELECT * INTO v_r FROM public.merchant_notifications WHERE notification_id = v_n.id;
  IF v_r.merchant_id <> 'c4a72000-0000-4000-8000-0000000000b1' OR v_r.in_app_visible IS NOT TRUE OR v_r.banner_visible THEN
    RAISE EXCEPTION 'unexpected recipient row: %', to_jsonb(v_r);
  END IF;
  IF (SELECT kind FROM public.chat_message_events WHERE event_key = 'evt-hand-0001') <> 'handover' THEN RAISE EXCEPTION 'handover not recorded as a handover'; END IF;
  -- A repeat of the same handover changes nothing; a nameless customer gets neutral wording.
  v := pg_temp.handover('evt-hand-0001', 7);
  IF v <> '{"outcome":"notified","duplicate":true}'::jsonb THEN RAISE EXCEPTION 'duplicate: %', v; END IF;
  v := pg_temp.handover('evt-hand-0002', 8, p_name => '');
  IF v <> '{"outcome":"notified"}'::jsonb OR NOT EXISTS (SELECT 1 FROM public.notifications n JOIN public.chat_message_events e ON e.notification_id = n.id
    WHERE e.event_key = 'evt-hand-0002' AND n.title = 'A customer needs a person') THEN RAISE EXCEPTION 'nameless handover: %', v; END IF;

  -- An unread message alert for the same chat never swallows a handover.
  v := pg_temp.message('evt-hand-msg01', 9);
  IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'message: %', v; END IF;
  v := pg_temp.handover('evt-hand-0003', 9);
  IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'handover after an unread message alert: %', v; END IF;

  -- The reported gap: at the handover-only level, ordinary messages are muted
  -- but the assistant's handover still alerts the merchant.
  INSERT INTO public.notification_preferences(merchant_id, chat_message_notifications) VALUES ('c4a72000-0000-4000-8000-0000000000b1', 'handover')
  ON CONFLICT (merchant_id) DO UPDATE SET chat_message_notifications = 'handover';
  v := pg_temp.message('evt-hand-msg02', 10);
  IF v <> '{"outcome":"muted"}'::jsonb THEN RAISE EXCEPTION 'handover level did not mute the message: %', v; END IF;
  v := pg_temp.handover('evt-hand-0004', 10);
  IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'handover level missed the handover: %', v; END IF;

  -- Off is the only silent level, and records the muted event without a notification.
  UPDATE public.notification_preferences SET chat_message_notifications = 'off' WHERE merchant_id = 'c4a72000-0000-4000-8000-0000000000b1';
  v := pg_temp.handover('evt-hand-0005', 11);
  IF v <> '{"outcome":"muted"}'::jsonb OR (SELECT notification_id FROM public.chat_message_events WHERE event_key = 'evt-hand-0005') IS NOT NULL THEN
    RAISE EXCEPTION 'off level still alerted: %', v;
  END IF;

  -- In-app switched off keeps the record but hides it from the bell.
  UPDATE public.notification_preferences SET chat_message_notifications = 'all', in_app_enabled = false WHERE merchant_id = 'c4a72000-0000-4000-8000-0000000000b1';
  v := pg_temp.handover('evt-hand-0006', 12);
  IF v <> '{"outcome":"notified"}'::jsonb OR EXISTS (SELECT 1 FROM public.merchant_notifications mn JOIN public.chat_message_events e ON e.notification_id = mn.notification_id
    WHERE e.event_key = 'evt-hand-0006' AND mn.in_app_visible) THEN RAISE EXCEPTION 'in-app preference ignored: %', v; END IF;
  UPDATE public.notification_preferences SET in_app_enabled = true WHERE merchant_id = 'c4a72000-0000-4000-8000-0000000000b1';

  -- Two handovers for one chat at the same moment are one alert; a later one alerts again.
  v := pg_temp.handover('evt-hand-race01', 40);
  IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'first racing handover: %', v; END IF;
  v := pg_temp.handover('evt-hand-race02', 40);
  IF v <> '{"outcome":"coalesced"}'::jsonb THEN RAISE EXCEPTION 'racing handover not coalesced: %', v; END IF;
  v := pg_temp.handover('evt-hand-race03', 41);
  IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'handover for another chat: %', v; END IF;
  UPDATE public.chat_message_events SET created_at = now() - interval '6 minutes' WHERE event_key = 'evt-hand-race01';
  v := pg_temp.handover('evt-hand-race04', 40);
  IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'later handover for the same chat: %', v; END IF;

  -- An unknown store is ignored without recording anything.
  v := pg_temp.handover('evt-hand-0007', 1, p_merchant => 'c4a72000-0000-4000-8000-0000000000ff');
  IF v <> '{"outcome":"ignored"}'::jsonb OR EXISTS (SELECT 1 FROM public.chat_message_events WHERE event_key = 'evt-hand-0007') THEN RAISE EXCEPTION 'unknown store: %', v; END IF;
END $$;

-- Hourly budget, counted apart from ordinary messages.
DO $$ DECLARE v jsonb; v_before integer; BEGIN
  SELECT count(*) INTO v_before FROM public.chat_message_events WHERE merchant_id = 'c4a72000-0000-4000-8000-0000000000b1' AND kind = 'handover' AND outcome = 'notified';
  FOR i IN 1..(60 - v_before) LOOP
    v := pg_temp.handover('evt-hand-surge-' || lpad(i::text, 3, '0'), 1000 + i);
    IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'surge % under budget: %', i, v; END IF;
  END LOOP;
  v := pg_temp.handover('evt-hand-surge-over', 5000);
  IF v <> '{"outcome":"coalesced"}'::jsonb THEN RAISE EXCEPTION 'over budget: %', v; END IF;
  UPDATE public.chat_message_events SET created_at = now() - interval '61 minutes' WHERE merchant_id = 'c4a72000-0000-4000-8000-0000000000b1';
  v := pg_temp.handover('evt-hand-surge-next', 5001);
  IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'after the hour: %', v; END IF;
END $$;

-- The two hourly caps are independent: handovers never use up the ordinary-message cap, and messages never use up the handover cap.
DO $$ DECLARE v jsonb; v_n integer; BEGIN
  SELECT count(*) INTO v_n FROM public.chat_message_events WHERE merchant_id = 'c4a72000-0000-4000-8000-0000000000b1' AND kind = 'handover' AND outcome = 'notified' AND created_at > now() - interval '1 hour';
  FOR i IN (v_n + 1)..60 LOOP
    v := pg_temp.handover('evt-hand-capa-' || lpad(i::text, 3, '0'), 8000 + i);
    IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'handover % under cap: %', i, v; END IF;
  END LOOP;
  v := pg_temp.handover('evt-hand-capa-over', 8999);
  IF v <> '{"outcome":"coalesced"}'::jsonb THEN RAISE EXCEPTION 'handover cap not enforced: %', v; END IF;
  -- Sixty handovers in the hour: an ordinary message still alerts.
  v := pg_temp.message('evt-hand-capmsg-1', 6000);
  IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'handovers used up the message cap: %', v; END IF;
  SELECT count(*) INTO v_n FROM public.chat_message_events WHERE merchant_id = 'c4a72000-0000-4000-8000-0000000000b1' AND kind = 'message' AND outcome = 'notified' AND created_at > now() - interval '1 hour';
  FOR i IN (v_n + 1)..60 LOOP
    v := pg_temp.message('evt-hand-capmsg-' || lpad((i + 1)::text, 3, '0'), 6000 + i);
    IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'message % under cap: %', i, v; END IF;
  END LOOP;
  v := pg_temp.message('evt-hand-capmsg-over', 7000);
  IF v <> '{"outcome":"coalesced"}'::jsonb THEN RAISE EXCEPTION 'message cap not enforced: %', v; END IF;
  -- Sixty fresh messages do not stop a handover once the handover hour has passed.
  UPDATE public.chat_message_events SET created_at = now() - interval '61 minutes' WHERE merchant_id = 'c4a72000-0000-4000-8000-0000000000b1' AND kind = 'handover';
  v := pg_temp.handover('evt-hand-capsplit', 7001);
  IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'messages used up the handover cap: %', v; END IF;
END $$;

-- A handover shares the push claim with messages and logs its own fixed wording.
CREATE FUNCTION pg_temp.push_proof(p_key text, p_claim uuid, p_action text) RETURNS text LANGUAGE sql AS $$
  SELECT encode(extensions.hmac(concat_ws('|', 'chat-event-push:v1', extract(epoch FROM now())::bigint::text, 'c4a72000-0000-4000-8000-0000000000b1', p_key, p_claim::text, p_action),
    'synthetic-chat-event-secret-0123456789abcdef', 'sha256'), 'hex');
$$;
DO $$
DECLARE m uuid := 'c4a72000-0000-4000-8000-0000000000b1'; claim uuid := 'c4a72000-0000-4000-8000-0000000000c1'; at bigint := extract(epoch FROM now())::bigint;
BEGIN
  IF NOT public.chat_event_claim_push(pg_temp.push_proof('evt-hand-0001', claim, 'claim'), at, m, 'evt-hand-0001', claim) THEN RAISE EXCEPTION 'handover push claim refused'; END IF;
  IF NOT public.chat_event_record_push_attempt(pg_temp.push_proof('evt-hand-0001', claim, 'attempt'), at, m, 'evt-hand-0001', claim, '{"status":"sent","token_count":1,"sent_count":1,"failed_count":0}'::jsonb) THEN
    RAISE EXCEPTION 'handover push attempt refused';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.push_notification_attempts WHERE merchant_id = m AND payload ->> 'event_key' = 'evt-hand-0001'
    AND title = 'A customer needs a person' AND body = 'The assistant handed this chat to your team. Open it to reply.') THEN
    RAISE EXCEPTION 'handover push log wording missing';
  END IF;
  -- The logged payload carries a structured marker so later queries can tell the two kinds apart.
  IF NOT EXISTS (SELECT 1 FROM public.push_notification_attempts WHERE merchant_id = m AND payload ->> 'event_key' = 'evt-hand-0001'
    AND payload ->> 'handover' = 'true') THEN
    RAISE EXCEPTION 'handover push log payload lacks the handover marker';
  END IF;
  -- An ordinary message still logs the original wording, and a muted handover cannot be claimed.
  IF NOT public.chat_event_claim_push(pg_temp.push_proof('evt-hand-msg01', claim, 'claim'), at, m, 'evt-hand-msg01', claim) THEN RAISE EXCEPTION 'message push claim refused'; END IF;
  IF NOT public.chat_event_record_push_attempt(pg_temp.push_proof('evt-hand-msg01', claim, 'attempt'), at, m, 'evt-hand-msg01', claim, '{"status":"sent"}'::jsonb) THEN RAISE EXCEPTION 'message push attempt refused'; END IF;
  -- Statements run one after another here: the lookup below must see the row written above.
  IF NOT EXISTS (SELECT 1 FROM public.push_notification_attempts WHERE payload ->> 'event_key' = 'evt-hand-msg01' AND title = 'New customer message') THEN
    RAISE EXCEPTION 'message push wording changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.push_notification_attempts WHERE payload ->> 'event_key' = 'evt-hand-msg01'
    AND payload ->> 'handover' = 'false') THEN
    RAISE EXCEPTION 'message push log payload should carry handover=false';
  END IF;
  IF public.chat_event_claim_push(pg_temp.push_proof('evt-hand-0005', claim, 'claim'), at, m, 'evt-hand-0005', claim) THEN RAISE EXCEPTION 'a muted handover was claimable for push'; END IF;
END $$;

-- Reachable by the public API role with a valid proof and nothing else; not by a signed-in user.
SELECT set_config('test.issued_at', extract(epoch FROM now())::bigint::text, true);
SELECT set_config('test.proof', pg_temp.handover_proof('synthetic-chat-event-secret-0123456789abcdef', current_setting('test.issued_at')::bigint, 'c4a72000-0000-4000-8000-0000000000b1', 'evt-hand-anon01', 30, 'Ada'), true);
SET LOCAL ROLE anon;
DO $$ DECLARE v jsonb; BEGIN
  v := public.record_chat_handover(current_setting('test.proof'), current_setting('test.issued_at')::bigint, 'c4a72000-0000-4000-8000-0000000000b1', 'evt-hand-anon01', 30, 'Ada');
  IF v <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'anon call: %', v; END IF;
  BEGIN PERFORM 1 FROM public.chat_message_events LIMIT 1; RAISE EXCEPTION 'anon read the event log';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.record_chat_handover(current_setting('test.proof'), current_setting('test.issued_at')::bigint, 'c4a72000-0000-4000-8000-0000000000b1', 'evt-hand-anon02', 31, 'Ada'); RAISE EXCEPTION 'a signed-in user could call the handover intake';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM LIKE 'chat_event%' THEN RAISE EXCEPTION 'signed-in call reached the function body'; END IF; END;
END $$;
RESET ROLE;

ROLLBACK;
