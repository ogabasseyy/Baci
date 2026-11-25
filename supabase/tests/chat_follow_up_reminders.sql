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
  -- The event kind check knows the new kind and still refuses unknown ones.
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'chat_message_events_kind_check')) NOT LIKE '%follow_up%' THEN
    RAISE EXCEPTION 'event kind check does not allow follow_up';
  END IF;
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

ROLLBACK;
