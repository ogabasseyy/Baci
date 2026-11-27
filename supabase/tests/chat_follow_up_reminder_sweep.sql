-- Behaviour of the chat follow-up reminder sweep: proofs, what is listed, taking a
-- reminder exactly once, the alert level and the push wording. Runs in one
-- transaction and rolls back: it leaves no merchant, secret, reminder or event
-- behind.
BEGIN;

\ir chat_follow_up_reminders.fixtures.inc.sql

-- The sweep: proofs.
DO $$
DECLARE r uuid := '5f2d3c1e-8a47-4b69-9c0e-1a2b3c4d5e6f';
BEGIN
  BEGIN PERFORM pg_temp.due(p_secret => 'another-secret-another-secret-another-0000'); RAISE EXCEPTION 'forged list proof accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_invalid' THEN RAISE; END IF; END;
  BEGIN PERFORM pg_temp.due(p_age => 301); RAISE EXCEPTION 'stale list proof accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_expired' THEN RAISE; END IF; END;
  BEGIN PERFORM pg_temp.due(p_age => -61); RAISE EXCEPTION 'future-dated list proof accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_expired' THEN RAISE; END IF; END;
  BEGIN PERFORM pg_temp.due(p_limit => 0); RAISE EXCEPTION 'a zero limit was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM pg_temp.due(p_limit => 51); RAISE EXCEPTION 'a limit above 50 was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  -- A list proof is not a record proof, and a proof for one limit is not a proof for another.
  BEGIN PERFORM public.list_due_chat_follow_up_reminders(pg_temp.list_proof('synthetic-chat-event-secret-0123456789abcdef', extract(epoch FROM now())::bigint, 25), extract(epoch FROM now())::bigint, 26);
    RAISE EXCEPTION 'a proof for another limit was accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_invalid' THEN RAISE; END IF; END;
  BEGIN PERFORM public.record_chat_follow_up_reminder(pg_temp.list_proof('synthetic-chat-event-secret-0123456789abcdef', extract(epoch FROM now())::bigint, 25), extract(epoch FROM now())::bigint, 'c4a73000-0000-4000-8000-0000000000b1', r, true);
    RAISE EXCEPTION 'a list proof was accepted as a record proof';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_invalid' THEN RAISE; END IF; END;
  BEGIN PERFORM pg_temp.take(r, p_secret => 'another-secret-another-secret-another-0000'); RAISE EXCEPTION 'forged record proof accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_invalid' THEN RAISE; END IF; END;
  BEGIN PERFORM pg_temp.take(r, p_age => 301); RAISE EXCEPTION 'stale record proof accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_expired' THEN RAISE; END IF; END;
  -- The send decision is part of the proof: a "false" answer cannot be flipped to "true".
  BEGIN PERFORM public.record_chat_follow_up_reminder(pg_temp.record_proof('synthetic-chat-event-secret-0123456789abcdef', extract(epoch FROM now())::bigint, 'c4a73000-0000-4000-8000-0000000000b1', r, false),
      extract(epoch FROM now())::bigint, 'c4a73000-0000-4000-8000-0000000000b1', r, true);
    RAISE EXCEPTION 'a flipped send decision was accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_invalid' THEN RAISE; END IF; END;
  IF EXISTS (SELECT 1 FROM public.chat_message_events WHERE merchant_id = 'c4a73000-0000-4000-8000-0000000000b1') THEN
    RAISE EXCEPTION 'a refused request recorded an event';
  END IF;
END $$;

-- The sweep: what is listed.
INSERT INTO public.chat_follow_up_reminders(id, merchant_id, conversation_id, due_at, customer_name, processed_at, created_at) VALUES
  ('c4a73000-0000-4000-8000-0000000000d1', 'c4a73000-0000-4000-8000-0000000000b1', 201, now() - interval '1 hour', 'Ada', NULL, now() - interval '3 hours'),
  ('c4a73000-0000-4000-8000-0000000000d2', 'c4a73000-0000-4000-8000-0000000000b1', 202, now() - interval '25 hours', 'Old', NULL, now() - interval '30 hours'),
  ('c4a73000-0000-4000-8000-0000000000d3', 'c4a73000-0000-4000-8000-0000000000b1', 203, now() + interval '1 hour', 'Future', NULL, now()),
  ('c4a73000-0000-4000-8000-0000000000d4', 'c4a73000-0000-4000-8000-0000000000b1', 204, now() - interval '2 hours', 'Handled', now() - interval '1 hour', now() - interval '4 hours'),
  ('c4a73000-0000-4000-8000-0000000000d5', 'c4a73000-0000-4000-8000-0000000000b1', 205, now() - interval '8 days', 'Ancient', NULL, now() - interval '9 days');

DO $$
DECLARE v_ids uuid[];
BEGIN
  SELECT array_agg(id ORDER BY id) INTO v_ids FROM pg_temp.due();
  IF v_ids IS DISTINCT FROM ARRAY['c4a73000-0000-4000-8000-0000000000d1'::uuid] THEN
    RAISE EXCEPTION 'listed the wrong reminders (only the one due in the last day and unhandled belongs): %', v_ids;
  END IF;
  -- Switching the feature on never replays a pile of old follow-ups: the day-old one stays unlisted
  -- and the week-old one is cleaned up.
  IF EXISTS (SELECT 1 FROM public.chat_follow_up_reminders WHERE id = 'c4a73000-0000-4000-8000-0000000000d5') THEN
    RAISE EXCEPTION 'a reminder older than a week was kept';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chat_follow_up_reminders WHERE id = 'c4a73000-0000-4000-8000-0000000000d2') THEN
    RAISE EXCEPTION 'a reminder just over a day old was cleaned up too early';
  END IF;
END $$;

-- The sweep: taking a reminder exactly once.
DO $$
DECLARE
  m uuid := 'c4a73000-0000-4000-8000-0000000000b1';
  d1 uuid := 'c4a73000-0000-4000-8000-0000000000d1';
  v jsonb;
  v_event public.chat_message_events;
  v_notifications integer;
BEGIN
  SELECT count(*) INTO v_notifications FROM public.notifications;
  v := pg_temp.take(d1);
  IF v <> '{"outcome":"notified","take":1}'::jsonb THEN RAISE EXCEPTION 'first take: %', v; END IF;
  SELECT * INTO v_event FROM public.chat_message_events WHERE merchant_id = m AND event_key = 'fu-' || replace(d1::text, '-', '');
  IF v_event.event_key IS NULL OR v_event.kind <> 'follow_up' OR v_event.outcome <> 'notified'
    OR v_event.conversation_id <> 201 OR v_event.notification_id IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected reminder event: %', to_jsonb(v_event);
  END IF;
  IF (SELECT count(*) FROM public.notifications) <> v_notifications THEN RAISE EXCEPTION 'a reminder wrote a bell notification'; END IF;
  IF (SELECT processed_at FROM public.chat_follow_up_reminders WHERE id = d1) IS NULL THEN RAISE EXCEPTION 'the taken reminder is not marked handled'; END IF;
  -- Never twice: the second take is ignored, nothing more is recorded, and it is no longer listed.
  v := pg_temp.take(d1);
  IF v <> '{"outcome":"ignored"}'::jsonb THEN RAISE EXCEPTION 'second take: %', v; END IF;
  IF (SELECT count(*) FROM public.chat_message_events WHERE merchant_id = m AND kind = 'follow_up') <> 1 THEN RAISE EXCEPTION 'a reminder recorded two events'; END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.due()) THEN RAISE EXCEPTION 'a handled reminder is still listed'; END IF;

  -- Not due yet, past the 24-hour window, or already handled: ignored and left as they were.
  IF pg_temp.take('c4a73000-0000-4000-8000-0000000000d3') <> '{"outcome":"ignored"}'::jsonb THEN RAISE EXCEPTION 'a future reminder was taken'; END IF;
  IF pg_temp.take('c4a73000-0000-4000-8000-0000000000d2') <> '{"outcome":"ignored"}'::jsonb THEN RAISE EXCEPTION 'a reminder past the window was taken'; END IF;
  IF pg_temp.take('c4a73000-0000-4000-8000-0000000000d4') <> '{"outcome":"ignored"}'::jsonb THEN RAISE EXCEPTION 'a handled reminder was taken again'; END IF;
  IF EXISTS (SELECT 1 FROM public.chat_follow_up_reminders WHERE id IN ('c4a73000-0000-4000-8000-0000000000d2', 'c4a73000-0000-4000-8000-0000000000d3') AND processed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'an ignored reminder was marked handled';
  END IF;
  -- Another store's id cannot take this store's reminder.
  IF pg_temp.take('c4a73000-0000-4000-8000-0000000000d3', p_merchant => 'c4a73000-0000-4000-8000-0000000000b2') <> '{"outcome":"ignored"}'::jsonb THEN
    RAISE EXCEPTION 'a reminder was taken through another store';
  END IF;
  IF (SELECT count(*) FROM public.chat_message_events WHERE merchant_id = m AND kind = 'follow_up') <> 1 THEN RAISE EXCEPTION 'an ignored take recorded an event'; END IF;
END $$;

-- A reminder the server found stale (chat finished, follow-up changed) is consumed without an event.
INSERT INTO public.chat_follow_up_reminders(id, merchant_id, conversation_id, due_at) VALUES
  ('c4a73000-0000-4000-8000-0000000000d6', 'c4a73000-0000-4000-8000-0000000000b1', 206, now() - interval '30 minutes'),
  ('c4a73000-0000-4000-8000-0000000000d7', 'c4a73000-0000-4000-8000-0000000000b1', 207, now() - interval '30 minutes');
DO $$
DECLARE d6 uuid := 'c4a73000-0000-4000-8000-0000000000d6'; d7 uuid := 'c4a73000-0000-4000-8000-0000000000d7';
BEGIN
  IF pg_temp.take(d6, p_send => false) <> '{"outcome":"ignored"}'::jsonb THEN RAISE EXCEPTION 'stale take did not answer ignored'; END IF;
  IF EXISTS (SELECT 1 FROM public.chat_message_events WHERE event_key = 'fu-' || replace(d6::text, '-', '')) THEN RAISE EXCEPTION 'a stale reminder recorded an event'; END IF;
  IF pg_temp.take(d6) <> '{"outcome":"ignored"}'::jsonb THEN RAISE EXCEPTION 'a consumed stale reminder was taken again'; END IF;
  -- A follow-up replaced after the sweep listed it: the old id is ignored, the new one is a new reminder.
  UPDATE public.chat_follow_up_reminders SET id = gen_random_uuid(), due_at = now() + interval '2 days', processed_at = NULL WHERE id = d7;
  IF pg_temp.take(d7) <> '{"outcome":"ignored"}'::jsonb THEN RAISE EXCEPTION 'a replaced reminder was sent under its old id'; END IF;
  IF EXISTS (SELECT 1 FROM public.chat_message_events WHERE event_key = 'fu-' || replace(d7::text, '-', '')) THEN RAISE EXCEPTION 'a replaced reminder recorded an event'; END IF;
END $$;

-- The alert level: "handover only" does NOT mute a reminder (the team asked for it), "off" does.
INSERT INTO public.chat_follow_up_reminders(id, merchant_id, conversation_id, due_at) VALUES
  ('c4a73000-0000-4000-8000-0000000000e1', 'c4a73000-0000-4000-8000-0000000000b1', 301, now() - interval '10 minutes'),
  ('c4a73000-0000-4000-8000-0000000000e2', 'c4a73000-0000-4000-8000-0000000000b1', 302, now() - interval '10 minutes'),
  ('c4a73000-0000-4000-8000-0000000000e3', 'c4a73000-0000-4000-8000-0000000000b1', 303, now() - interval '10 minutes');
INSERT INTO public.notification_preferences(merchant_id, chat_message_notifications) VALUES ('c4a73000-0000-4000-8000-0000000000b1', 'handover')
ON CONFLICT (merchant_id) DO UPDATE SET chat_message_notifications = 'handover';
DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.take('c4a73000-0000-4000-8000-0000000000e1');
  IF v <> '{"outcome":"notified","take":1}'::jsonb THEN RAISE EXCEPTION 'handover-only level muted a reminder: %', v; END IF;
  UPDATE public.notification_preferences SET chat_message_notifications = 'off' WHERE merchant_id = 'c4a73000-0000-4000-8000-0000000000b1';
  v := pg_temp.take('c4a73000-0000-4000-8000-0000000000e2');
  IF v <> '{"outcome":"muted"}'::jsonb THEN RAISE EXCEPTION 'off level did not mute: %', v; END IF;
  IF (SELECT outcome FROM public.chat_message_events WHERE event_key = 'fu-' || replace('c4a73000-0000-4000-8000-0000000000e2'::text, '-', '')) <> 'muted' THEN
    RAISE EXCEPTION 'the muted reminder was not recorded as muted';
  END IF;
  IF (SELECT processed_at FROM public.chat_follow_up_reminders WHERE id = 'c4a73000-0000-4000-8000-0000000000e2') IS NULL THEN
    RAISE EXCEPTION 'a muted reminder stays pending and would be retried';
  END IF;
  UPDATE public.notification_preferences SET chat_message_notifications = 'all' WHERE merchant_id = 'c4a73000-0000-4000-8000-0000000000b1';
  v := pg_temp.take('c4a73000-0000-4000-8000-0000000000e3');
  IF v <> '{"outcome":"notified","take":1}'::jsonb THEN RAISE EXCEPTION 'the all level did not notify: %', v; END IF;
END $$;

-- The reminder event is pushed through the existing proof-and-claim wrappers, once.
DO $$
DECLARE
  m uuid := 'c4a73000-0000-4000-8000-0000000000b1';
  key text := 'fu-' || replace('c4a73000-0000-4000-8000-0000000000d1'::text, '-', '');
  claim uuid := 'c4a73000-0000-4000-8000-0000000000c1';
  other_claim uuid := 'c4a73000-0000-4000-8000-0000000000c2';
BEGIN
  IF NOT public.chat_event_claim_push(pg_temp.push_proof(key, claim, 'claim'), extract(epoch FROM now())::bigint, m, key, claim) THEN
    RAISE EXCEPTION 'the reminder event could not be claimed for a push';
  END IF;
  IF public.chat_event_claim_push(pg_temp.push_proof(key, other_claim, 'claim'), extract(epoch FROM now())::bigint, m, key, other_claim) THEN
    RAISE EXCEPTION 'a reminder event was claimed for a push twice';
  END IF;
  -- A muted reminder event has no push to claim.
  IF public.chat_event_claim_push(pg_temp.push_proof('fu-' || replace('c4a73000-0000-4000-8000-0000000000e2'::text, '-', ''), claim, 'claim'),
    extract(epoch FROM now())::bigint, m, 'fu-' || replace('c4a73000-0000-4000-8000-0000000000e2'::text, '-', ''), claim) THEN
    RAISE EXCEPTION 'a muted reminder event was claimed for a push';
  END IF;
  -- The push log keeps fixed wording: never the customer's name or text.
  IF NOT public.chat_event_record_push_attempt(pg_temp.push_proof(key, claim, 'attempt'), extract(epoch FROM now())::bigint, m, key, claim,
    '{"status":"sent","token_count":1,"sent_count":1,"failed_count":0,"title":"Follow up: Ada","body":"card 1234","errors":[]}'::jsonb) THEN
    RAISE EXCEPTION 'attempt refused';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.push_notification_attempts WHERE merchant_id = m AND notification_type = 'customer_message'
    AND app_type = 'admin' AND status = 'sent'
    AND title = 'Time to follow up' AND body = 'This chat is due for a follow-up. Open it to reply.'
    AND payload = pg_catalog.jsonb_build_object('type', 'customer_message', 'event_key', key, 'handover', false, 'follow_up', true)) THEN
    RAISE EXCEPTION 'reminder attempt row is not the fixed, scoped record';
  END IF;
END $$;

-- The redefined attempt log still words the other two kinds as before.
INSERT INTO public.chat_message_events(merchant_id, event_key, conversation_id, outcome, kind, push_claim, push_claimed_at) VALUES
  ('c4a73000-0000-4000-8000-0000000000b1', 'evt-fu-message', 401, 'notified', 'message', 'c4a73000-0000-4000-8000-0000000000c3', now()),
  ('c4a73000-0000-4000-8000-0000000000b1', 'evt-fu-handover', 402, 'notified', 'handover', 'c4a73000-0000-4000-8000-0000000000c4', now());
DO $$
DECLARE m uuid := 'c4a73000-0000-4000-8000-0000000000b1';
BEGIN
  PERFORM public.chat_event_record_push_attempt(pg_temp.push_proof('evt-fu-message', 'c4a73000-0000-4000-8000-0000000000c3', 'attempt'), extract(epoch FROM now())::bigint, m, 'evt-fu-message',
    'c4a73000-0000-4000-8000-0000000000c3', '{"status":"sent","token_count":1,"sent_count":1,"failed_count":0}'::jsonb);
  PERFORM public.chat_event_record_push_attempt(pg_temp.push_proof('evt-fu-handover', 'c4a73000-0000-4000-8000-0000000000c4', 'attempt'), extract(epoch FROM now())::bigint, m, 'evt-fu-handover',
    'c4a73000-0000-4000-8000-0000000000c4', '{"status":"sent","token_count":1,"sent_count":1,"failed_count":0}'::jsonb);
  IF NOT EXISTS (SELECT 1 FROM public.push_notification_attempts WHERE merchant_id = m AND title = 'New customer message'
    AND body = 'A customer sent a message to your store.' AND payload = '{"type":"customer_message","event_key":"evt-fu-message","handover":false}'::jsonb) THEN
    RAISE EXCEPTION 'message attempt wording changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.push_notification_attempts WHERE merchant_id = m AND title = 'A customer needs a person'
    AND body = 'The assistant handed this chat to your team. Open it to reply.' AND payload = '{"type":"customer_message","event_key":"evt-fu-handover","handover":true}'::jsonb) THEN
    RAISE EXCEPTION 'handover attempt wording changed';
  END IF;
END $$;

-- Taking a reminder also does the same bounded cleanup as the other chat
-- intakes, so a store that only uses follow-ups does not keep events for ever.
INSERT INTO public.chat_message_events(merchant_id, event_key, conversation_id, outcome, kind, created_at) VALUES
  ('c4a73000-0000-4000-8000-0000000000b1', 'evt-fu-expired', 451, 'notified', 'follow_up', now() - interval '31 days'),
  ('c4a73000-0000-4000-8000-0000000000b1', 'evt-fu-recent', 452, 'notified', 'follow_up', now() - interval '29 days'),
  ('c4a73000-0000-4000-8000-0000000000b2', 'evt-fu-other-store', 453, 'notified', 'follow_up', now() - interval '31 days');
INSERT INTO public.chat_follow_up_reminders(id, merchant_id, conversation_id, due_at) VALUES
  ('c4a73000-0000-4000-8000-0000000000e4', 'c4a73000-0000-4000-8000-0000000000b1', 304, now() - interval '10 minutes');
DO $$
BEGIN
  IF pg_temp.take('c4a73000-0000-4000-8000-0000000000e4') <> '{"outcome":"notified","take":1}'::jsonb THEN
    RAISE EXCEPTION 'the cleanup take did not notify';
  END IF;
  IF EXISTS (SELECT 1 FROM public.chat_message_events WHERE event_key = 'evt-fu-expired') THEN
    RAISE EXCEPTION 'an event older than 30 days survived a follow-up take';
  END IF;
  IF (SELECT count(*) FROM public.chat_message_events WHERE event_key IN ('evt-fu-recent', 'evt-fu-other-store')) <> 2 THEN
    RAISE EXCEPTION 'the cleanup removed a recent event or another store''s event';
  END IF;
END $$;

-- Deleting the store removes its reminders.
DO $$
BEGIN
  IF (SELECT confdeltype FROM pg_constraint WHERE conrelid = 'public.chat_follow_up_reminders'::regclass AND contype = 'f') <> 'c' THEN
    RAISE EXCEPTION 'reminders do not cascade from the merchant';
  END IF;
END $$;

-- Fair listing: a reminder the sweep cannot act on moves to the back of the line,
-- so it never starves the reminders behind it (one store's unreadable chat engine).
INSERT INTO public.chat_follow_up_reminders(id, merchant_id, conversation_id, due_at) VALUES
  ('c4a73000-0000-4000-8000-0000000000f1', 'c4a73000-0000-4000-8000-0000000000b1', 501, now() - interval '5 hours'),
  ('c4a73000-0000-4000-8000-0000000000f2', 'c4a73000-0000-4000-8000-0000000000b1', 502, now() - interval '4 hours'),
  ('c4a73000-0000-4000-8000-0000000000f3', 'c4a73000-0000-4000-8000-0000000000b1', 503, now() - interval '3 hours');
DO $$
DECLARE v_first uuid[]; v_second uuid[]; v_third bigint[];
BEGIN
  SELECT array_agg(id ORDER BY due_at) INTO v_first FROM pg_temp.due(2);
  IF v_first IS DISTINCT FROM ARRAY['c4a73000-0000-4000-8000-0000000000f1'::uuid, 'c4a73000-0000-4000-8000-0000000000f2'::uuid] THEN
    RAISE EXCEPTION 'first look did not return the oldest two: %', v_first;
  END IF;
  -- Neither was acted on (left as they were): the next look reaches the one behind them.
  SELECT array_agg(id ORDER BY due_at) INTO v_second FROM pg_temp.due(2);
  IF NOT ('c4a73000-0000-4000-8000-0000000000f3'::uuid = ANY (v_second)) THEN
    RAISE EXCEPTION 'unactionable reminders starved the one behind them: %', v_second;
  END IF;
  IF (SELECT count(*) FROM public.chat_follow_up_reminders WHERE id IN
    ('c4a73000-0000-4000-8000-0000000000f1', 'c4a73000-0000-4000-8000-0000000000f2', 'c4a73000-0000-4000-8000-0000000000f3') AND last_listed_at IS NOT NULL) <> 3 THEN
    RAISE EXCEPTION 'looked-at reminders were not stamped';
  END IF;
  -- Replacing a follow-up through the app starts it afresh (unlisted, unhandled), as the app's upsert does.
  UPDATE public.chat_follow_up_reminders SET id = gen_random_uuid(), processed_at = NULL, last_listed_at = NULL WHERE conversation_id = 501;
  SELECT array_agg(conversation_id ORDER BY due_at) INTO v_third FROM pg_temp.due(1);
  IF v_third IS DISTINCT FROM ARRAY[501::bigint] THEN RAISE EXCEPTION 'a replaced reminder did not go to the front: %', v_third; END IF;
END $$;

ROLLBACK;
