-- Behaviour of the chat follow-up reminders table: who may write reminders (row-
-- level security), the function and table grants, and the proof vectors the Node
-- builders are tested against. Runs in one transaction and rolls back: it leaves
-- no merchant, secret, staff member or reminder behind.
BEGIN;

\ir chat_follow_up_reminders.fixtures.inc.sql

-- Catalog: row-level security is on, the sweep functions are reachable without a
-- session, and the shared proof helper is not reachable at all. Denied access is
-- asserted from the catalog, never by calling and catching.
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.chat_follow_up_reminders'::regclass) THEN
    RAISE EXCEPTION 'row-level security is off on chat_follow_up_reminders';
  END IF;
  IF has_table_privilege('anon', 'public.chat_follow_up_reminders', 'SELECT')
    OR has_table_privilege('anon', 'public.chat_follow_up_reminders', 'INSERT') THEN
    RAISE EXCEPTION 'anon can reach the reminder table';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.chat_follow_up_reminders', 'INSERT') THEN
    RAISE EXCEPTION 'signed-in team members cannot write reminders';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'chat_follow_up_reminders') <> 4 THEN
    RAISE EXCEPTION 'expected one policy each for select, insert, update and delete';
  END IF;
  IF NOT has_function_privilege('anon', 'public.list_due_chat_follow_up_reminders(text,bigint,integer)', 'EXECUTE')
    OR NOT has_function_privilege('anon', 'public.record_chat_follow_up_reminder(text,bigint,uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the sweep functions must be executable by anon (proof-gated)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid IN ('public.list_due_chat_follow_up_reminders(text,bigint,integer)'::regprocedure,
                    'public.record_chat_follow_up_reminder(text,bigint,uuid,uuid,boolean)'::regprocedure)
      AND a.grantee = 0
  ) THEN RAISE EXCEPTION 'a sweep function is executable by PUBLIC'; END IF;
  IF has_function_privilege('anon', 'private.chat_event_require_proof(text,text,bigint)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'private.chat_event_require_proof(text,text,bigint)', 'EXECUTE')
    OR has_function_privilege('service_role', 'private.chat_event_require_proof(text,text,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the proof helper is reachable from an API role';
  END IF;
  -- The event kind check still refuses unknown kinds (the sweep suite inserts follow_up ones).
  BEGIN
    INSERT INTO public.chat_message_events(merchant_id, event_key, conversation_id, outcome, kind)
    VALUES ('c4a73000-0000-4000-8000-0000000000b1', 'evt-unknown-kind', 1, 'notified', 'something_else');
    RAISE EXCEPTION 'an unknown event kind was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- Proof vectors the Node builders are tested against (chat-follow-up-reminder-intake.test.ts).
DO $$
BEGIN
  IF pg_temp.list_proof('synthetic-chat-event-secret-0123456789abcdef', 1794730000, 25)
    <> 'a816a77a6ba579fedcea14c081b2a5f94726cda72358c307d14a9685505dcc6e' THEN
    RAISE EXCEPTION 'list proof vector drifted from the Node builder';
  END IF;
  IF pg_temp.record_proof('synthetic-chat-event-secret-0123456789abcdef', 1794730000, 'c4a70000-0000-4000-8000-0000000000b1', '5f2d3c1e-8a47-4b69-9c0e-1a2b3c4d5e6f', true)
    <> '4e67154cc3b925f3f376fa1a7acc59af9e413c3047a04b16306e5985f6183518' THEN
    RAISE EXCEPTION 'record proof vector drifted from the Node builder';
  END IF;
END $$;

-- Who may write: the owner and staff with the inbox edit permission, nobody else.
SELECT pg_temp.as_user('c4a73000-0000-4000-8000-0000000000a1');
SET LOCAL ROLE authenticated;
DO $$
DECLARE m uuid := 'c4a73000-0000-4000-8000-0000000000b1'; v_first uuid; v_second uuid;
BEGIN
  INSERT INTO public.chat_follow_up_reminders(merchant_id, conversation_id, due_at, customer_name)
  VALUES (m, 100, now() + interval '2 days', 'Ada');
  SELECT id INTO v_first FROM public.chat_follow_up_reminders WHERE merchant_id = m AND conversation_id = 100;
  -- Setting another follow-up on the same chat replaces the row under a new id.
  INSERT INTO public.chat_follow_up_reminders(id, merchant_id, conversation_id, due_at, customer_name)
  VALUES (gen_random_uuid(), m, 100, now() + interval '3 days', 'Ada')
  ON CONFLICT (merchant_id, conversation_id) DO UPDATE
  SET id = EXCLUDED.id, due_at = EXCLUDED.due_at, customer_name = EXCLUDED.customer_name, processed_at = NULL;
  SELECT id INTO v_second FROM public.chat_follow_up_reminders WHERE merchant_id = m AND conversation_id = 100;
  IF v_first = v_second THEN RAISE EXCEPTION 'a replaced reminder kept its identity'; END IF;
  IF (SELECT count(*) FROM public.chat_follow_up_reminders WHERE merchant_id = m AND conversation_id = 100) <> 1 THEN
    RAISE EXCEPTION 'a chat has more than one pending reminder';
  END IF;
  -- Not for another store, not further than 91 days out, not with an oversized name or a bad chat id.
  BEGIN
    INSERT INTO public.chat_follow_up_reminders(merchant_id, conversation_id, due_at) VALUES ('c4a73000-0000-4000-8000-0000000000b2', 100, now() + interval '1 day');
    RAISE EXCEPTION 'the owner of one store wrote a reminder into another';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.chat_follow_up_reminders(merchant_id, conversation_id, due_at) VALUES (m, 101, now() + interval '92 days');
    RAISE EXCEPTION 'a reminder further than 91 days out was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.chat_follow_up_reminders(merchant_id, conversation_id, due_at) VALUES (m, 103, now() - interval '1 hour');
    RAISE EXCEPTION 'a follow-up in the past was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.chat_follow_up_reminders(merchant_id, conversation_id, due_at, customer_name) VALUES (m, 102, now() + interval '1 day', repeat('x', 81));
    RAISE EXCEPTION 'an oversized name was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.chat_follow_up_reminders(merchant_id, conversation_id, due_at) VALUES (m, 0, now() + interval '1 day');
    RAISE EXCEPTION 'a zero chat id was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- A chat id the web server cannot hold exactly.
  BEGIN
    INSERT INTO public.chat_follow_up_reminders(merchant_id, conversation_id, due_at) VALUES (m, 9007199254740992, now() + interval '1 day');
    RAISE EXCEPTION 'an unreadable chat id was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  DELETE FROM public.chat_follow_up_reminders WHERE merchant_id = m AND conversation_id = 100;
  IF EXISTS (SELECT 1 FROM public.chat_follow_up_reminders WHERE conversation_id = 100) THEN RAISE EXCEPTION 'the owner could not clear a reminder'; END IF;
END $$;
RESET ROLE;

SELECT pg_temp.as_user('c4a73000-0000-4000-8000-0000000000a3');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  INSERT INTO public.chat_follow_up_reminders(merchant_id, conversation_id, due_at) VALUES ('c4a73000-0000-4000-8000-0000000000b1', 110, now() + interval '1 day');
  IF NOT EXISTS (SELECT 1 FROM public.chat_follow_up_reminders WHERE conversation_id = 110) THEN RAISE EXCEPTION 'staff with edit could not see their reminder'; END IF;
END $$;
RESET ROLE;

-- Inbox "edit" without "view" is a grant the inbox API accepts, so the app's
-- save (an upsert), reschedule and clear must work for it too: Postgres needs
-- the row to be visible for each of them.
SELECT pg_temp.as_user('c4a73000-0000-4000-8000-0000000000a6');
SET LOCAL ROLE authenticated;
DO $$
DECLARE m uuid := 'c4a73000-0000-4000-8000-0000000000b1'; v_days integer; v_changed integer;
BEGIN
  FOR v_days IN 1..2 LOOP
    INSERT INTO public.chat_follow_up_reminders(merchant_id, conversation_id, due_at)
    VALUES (m, 115, now() + make_interval(days => v_days))
    ON CONFLICT (merchant_id, conversation_id) DO UPDATE
    SET merchant_id = EXCLUDED.merchant_id, conversation_id = EXCLUDED.conversation_id, due_at = EXCLUDED.due_at;
  END LOOP;
  IF (SELECT due_at FROM public.chat_follow_up_reminders WHERE conversation_id = 115) IS DISTINCT FROM now() + interval '2 days' THEN
    RAISE EXCEPTION 'edit-only staff could not reschedule their reminder';
  END IF;
  DELETE FROM public.chat_follow_up_reminders WHERE merchant_id = m AND conversation_id = 115;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 1 THEN RAISE EXCEPTION 'edit-only staff could not clear their reminder'; END IF;
END $$;
RESET ROLE;

-- Staff who may only view see reminders but cannot write or remove them.
SELECT pg_temp.as_user('c4a73000-0000-4000-8000-0000000000a4');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_deleted integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.chat_follow_up_reminders WHERE conversation_id = 110) THEN RAISE EXCEPTION 'staff with view cannot see reminders'; END IF;
  BEGIN
    INSERT INTO public.chat_follow_up_reminders(merchant_id, conversation_id, due_at) VALUES ('c4a73000-0000-4000-8000-0000000000b1', 111, now() + interval '1 day');
    RAISE EXCEPTION 'view-only staff wrote a reminder';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  DELETE FROM public.chat_follow_up_reminders WHERE conversation_id = 110;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 0 THEN RAISE EXCEPTION 'view-only staff removed a reminder'; END IF;
END $$;
RESET ROLE;

-- An outsider and another store's owner see and change nothing.
SELECT pg_temp.as_user('c4a73000-0000-4000-8000-0000000000a2');
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_changed integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.chat_follow_up_reminders) THEN RAISE EXCEPTION 'an outsider can see reminders'; END IF;
  UPDATE public.chat_follow_up_reminders SET customer_name = 'x';
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 0 THEN RAISE EXCEPTION 'an outsider changed a reminder'; END IF;
  DELETE FROM public.chat_follow_up_reminders;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 0 THEN RAISE EXCEPTION 'an outsider removed a reminder'; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.as_user('c4a73000-0000-4000-8000-0000000000a5');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.chat_follow_up_reminders) THEN RAISE EXCEPTION 'another store''s owner can see reminders'; END IF;
END $$;
RESET ROLE;
DELETE FROM public.chat_follow_up_reminders WHERE conversation_id = 110;

-- What the sweep did with a reminder is not the team's to change: staff with
-- the edit permission, writing straight to the database, cannot make a handled
-- reminder due again or choose its identity.
INSERT INTO public.chat_follow_up_reminders(id, merchant_id, conversation_id, due_at, processed_at, last_listed_at, attempts)
VALUES ('c4a73000-0000-4000-8000-000000000120', 'c4a73000-0000-4000-8000-0000000000b1', 120, now() - interval '5 minutes', now(), now(), 3);
SELECT pg_temp.as_user('c4a73000-0000-4000-8000-0000000000a3');
SET LOCAL ROLE authenticated;
DO $$
DECLARE old_id uuid := 'c4a73000-0000-4000-8000-000000000120'; r public.chat_follow_up_reminders;
BEGIN
  UPDATE public.chat_follow_up_reminders SET id = gen_random_uuid(), processed_at = NULL, last_listed_at = NULL, attempts = 0, updated_at = now() - interval '1 day'
  WHERE conversation_id = 120;
  SELECT * INTO r FROM public.chat_follow_up_reminders WHERE conversation_id = 120;
  IF NOT FOUND THEN RAISE EXCEPTION 'reminder row 120 is missing'; END IF;
  IF r.id <> old_id OR r.processed_at IS NULL OR r.last_listed_at IS NULL OR r.attempts <> 3 OR r.updated_at <> now() THEN
    RAISE EXCEPTION 'edit staff made a handled reminder due again';
  END IF;
  -- A new time is a new follow-up: new identity, nothing handled.
  UPDATE public.chat_follow_up_reminders SET due_at = now() + interval '1 day', attempts = 2, processed_at = now() WHERE conversation_id = 120;
  SELECT * INTO r FROM public.chat_follow_up_reminders WHERE conversation_id = 120;
  IF NOT FOUND THEN RAISE EXCEPTION 'reminder row 120 is missing'; END IF;
  IF r.id = old_id OR r.processed_at IS NOT NULL OR r.last_listed_at IS NOT NULL OR r.attempts <> 0 THEN
    RAISE EXCEPTION 'a new time did not start a new reminder';
  END IF;
  -- Nor can an insert reuse an identity or arrive already handled.
  INSERT INTO public.chat_follow_up_reminders(id, merchant_id, conversation_id, due_at, processed_at, attempts)
  VALUES (old_id, 'c4a73000-0000-4000-8000-0000000000b1', 121, now() + interval '1 day', now(), 3);
  SELECT * INTO r FROM public.chat_follow_up_reminders WHERE conversation_id = 121;
  IF NOT FOUND THEN RAISE EXCEPTION 'reminder row 121 is missing'; END IF;
  IF r.id = old_id OR r.processed_at IS NOT NULL OR r.attempts <> 0 THEN
    RAISE EXCEPTION 'an insert chose its identity or its history';
  END IF;
END $$;
RESET ROLE;

ROLLBACK;
