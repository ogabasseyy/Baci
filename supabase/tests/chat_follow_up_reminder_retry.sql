-- Putting a taken follow-up reminder back: after a push that never left the
-- server, and after a run that stopped before sending began. Never after a push
-- marked as sending (unless the server says so), at most three takes spaced
-- out, only in the 24-hour window. Runs in one transaction and rolls back.
BEGIN;

\ir chat_follow_up_reminders.fixtures.inc.sql

DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.release_chat_follow_up_reminder(text,bigint,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'release must be executable by anon (proof-gated)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid = 'public.release_chat_follow_up_reminder(text,bigint,uuid,uuid)'::regprocedure AND a.grantee = 0) THEN
    RAISE EXCEPTION 'release is executable by PUBLIC';
  END IF;
  IF NOT has_function_privilege('anon', 'public.chat_event_mark_push_dispatch(text,bigint,uuid,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the dispatch mark must be executable by anon (proof-gated)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid = 'public.chat_event_mark_push_dispatch(text,bigint,uuid,text,uuid)'::regprocedure AND a.grantee = 0) THEN
    RAISE EXCEPTION 'the dispatch mark is executable by PUBLIC';
  END IF;
  IF has_function_privilege('anon', 'private.requeue_chat_follow_up_reminder(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'private.requeue_chat_follow_up_reminder(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'private.requeue_chat_follow_up_reminder(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the requeue helper is reachable from an API role';
  END IF;
  -- Proof vector the Node builder is tested against.
  IF encode(extensions.hmac(concat_ws('|', 'chat-follow-up-release:v1', '1794730000', 'c4a70000-0000-4000-8000-0000000000b1', '5f2d3c1e-8a47-4b69-9c0e-1a2b3c4d5e6f'),
    'synthetic-chat-event-secret-0123456789abcdef', 'sha256'), 'hex') <> '1ebb2ecdc817b0acf56d7d4af442f6373763ed165d25664731927445cb7616ac' THEN
    RAISE EXCEPTION 'release proof vector drifted from the Node builder';
  END IF;
  BEGIN PERFORM pg_temp.release('c4a73000-0000-4000-8000-000000000101', p_secret => 'another-secret-another-secret-another-0000'); RAISE EXCEPTION 'forged release proof accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_invalid' THEN RAISE; END IF; END;
END $$;

INSERT INTO public.chat_follow_up_reminders(id, merchant_id, conversation_id, due_at) VALUES
  ('c4a73000-0000-4000-8000-000000000101', 'c4a73000-0000-4000-8000-0000000000b1', 601, now() - interval '1 hour'),
  ('c4a73000-0000-4000-8000-000000000102', 'c4a73000-0000-4000-8000-0000000000b1', 602, now() - interval '1 hour');

-- A released reminder is listed and taken again, three takes in all.
DO $$
DECLARE r uuid := 'c4a73000-0000-4000-8000-000000000101'; claim uuid := 'c4a73000-0000-4000-8000-0000000000c1';
  key text := 'fu-' || replace('c4a73000-0000-4000-8000-000000000101', '-', '');
BEGIN
  IF pg_temp.release(r) THEN RAISE EXCEPTION 'a reminder that was never taken was released'; END IF;
  IF pg_temp.take(r) <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'first take refused'; END IF;
  -- Another store's id releases nothing.
  IF pg_temp.release(r, 'c4a73000-0000-4000-8000-0000000000b2') THEN RAISE EXCEPTION 'released through another store'; END IF;
  -- Claimed but never dispatched: the server may still release it.
  PERFORM public.chat_event_claim_push(pg_temp.push_proof(key, claim, 'claim'), extract(epoch FROM now())::bigint, 'c4a73000-0000-4000-8000-0000000000b1', key, claim);
  IF NOT pg_temp.release(r) THEN RAISE EXCEPTION 'release refused'; END IF;
  -- Asking again says the same: it is already back.
  IF NOT pg_temp.release(r) THEN RAISE EXCEPTION 'an already put back reminder was reported as lost'; END IF;
  IF EXISTS (SELECT 1 FROM public.chat_message_events WHERE event_key = key) THEN RAISE EXCEPTION 'the released event was kept'; END IF;
  -- Retries are spaced: ten minutes after the first take, two hours after the second.
  IF EXISTS (SELECT 1 FROM pg_temp.due() WHERE id = r) THEN RAISE EXCEPTION 'a first retry did not wait'; END IF;
  PERFORM pg_temp.age_take(r, interval '11 minutes');
  IF NOT EXISTS (SELECT 1 FROM pg_temp.due() WHERE id = r) THEN RAISE EXCEPTION 'a released reminder is not listed again'; END IF;
  IF pg_temp.take(r) <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'second take refused'; END IF;
  IF NOT pg_temp.release(r) THEN RAISE EXCEPTION 'second release refused'; END IF;
  PERFORM pg_temp.age_take(r, interval '11 minutes');
  IF EXISTS (SELECT 1 FROM pg_temp.due() WHERE id = r) THEN RAISE EXCEPTION 'a second retry did not wait two hours'; END IF;
  PERFORM pg_temp.age_take(r, interval '121 minutes');
  IF NOT EXISTS (SELECT 1 FROM pg_temp.due() WHERE id = r) THEN RAISE EXCEPTION 'a second retry never came'; END IF;
  IF pg_temp.take(r) <> '{"outcome":"notified"}'::jsonb THEN RAISE EXCEPTION 'third take refused'; END IF;
  IF pg_temp.release(r) THEN RAISE EXCEPTION 'a fourth take was allowed'; END IF;
END $$;

-- A run that stopped before sending began (with or without a claim) is put
-- back after ten minutes, not sooner; one marked as sending stays taken.
DO $$
DECLARE r uuid := 'c4a73000-0000-4000-8000-000000000102'; claim uuid := 'c4a73000-0000-4000-8000-0000000000c2';
  key text := 'fu-' || replace('c4a73000-0000-4000-8000-000000000102', '-', '');
BEGIN
  PERFORM pg_temp.take(r);
  IF EXISTS (SELECT 1 FROM pg_temp.due() WHERE id = r) THEN RAISE EXCEPTION 'a just-taken reminder was put back'; END IF;
  PERFORM pg_temp.age_take(r, interval '11 minutes');
  IF NOT EXISTS (SELECT 1 FROM pg_temp.due() WHERE id = r) THEN RAISE EXCEPTION 'an unclaimed taken reminder was lost'; END IF;
  PERFORM pg_temp.take(r);
  PERFORM public.chat_event_claim_push(pg_temp.push_proof(key, claim, 'claim'), extract(epoch FROM now())::bigint, 'c4a73000-0000-4000-8000-0000000000b1', key, claim);
  PERFORM pg_temp.age_take(r, interval '121 minutes');
  IF EXISTS (SELECT 1 FROM pg_temp.due() WHERE id = r) THEN RAISE EXCEPTION 'a push with a live claim was put back'; END IF;
  UPDATE public.chat_message_events SET push_claimed_at = now() - interval '11 minutes' WHERE event_key = key;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.due() WHERE id = r) THEN RAISE EXCEPTION 'a claimed push that never began sending was lost'; END IF;
  -- The stopped run waking up late finds no event and may not send.
  IF pg_temp.mark(key, claim) THEN RAISE EXCEPTION 'a stopped run could still send after the put back'; END IF;
END $$;

INSERT INTO public.chat_follow_up_reminders(id, merchant_id, conversation_id, due_at) VALUES
  ('c4a73000-0000-4000-8000-000000000104', 'c4a73000-0000-4000-8000-0000000000b1', 604, now() - interval '1 hour');
DO $$
DECLARE r uuid := 'c4a73000-0000-4000-8000-000000000104'; claim uuid := 'c4a73000-0000-4000-8000-0000000000c4';
  key text := 'fu-' || replace('c4a73000-0000-4000-8000-000000000104', '-', '');
BEGIN
  PERFORM pg_temp.take(r);
  PERFORM public.chat_event_claim_push(pg_temp.push_proof(key, claim, 'claim'), extract(epoch FROM now())::bigint, 'c4a73000-0000-4000-8000-0000000000b1', key, claim);
  IF pg_temp.mark(key, 'c4a73000-0000-4000-8000-0000000000c9') THEN RAISE EXCEPTION 'another claim marked the push'; END IF;
  IF NOT pg_temp.mark(key, claim) THEN RAISE EXCEPTION 'the claim holder could not mark the push'; END IF;
  PERFORM pg_temp.age_take(r, interval '121 minutes');
  IF EXISTS (SELECT 1 FROM pg_temp.due() WHERE id = r) THEN RAISE EXCEPTION 'a push marked as sending was put back: it could go out twice'; END IF;
  -- Nor on the server's own say-so: the mark is the database's guarantee.
  IF pg_temp.release(r) THEN RAISE EXCEPTION 'a push marked as sending was released'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chat_message_events WHERE event_key = key) THEN RAISE EXCEPTION 'a marked event was removed'; END IF;
END $$;

-- A stale or muted reminder has no notified event and is never put back.
INSERT INTO public.chat_follow_up_reminders(id, merchant_id, conversation_id, due_at) VALUES
  ('c4a73000-0000-4000-8000-000000000103', 'c4a73000-0000-4000-8000-0000000000b1', 603, now() - interval '1 hour');
DO $$
BEGIN
  PERFORM pg_temp.take('c4a73000-0000-4000-8000-000000000103', p_send => false);
  IF pg_temp.release('c4a73000-0000-4000-8000-000000000103') THEN RAISE EXCEPTION 'a stale reminder was put back'; END IF;
END $$;

ROLLBACK;
