-- Behaviour of the three-way chat alert level functions. Runs in one
-- transaction and rolls back: it leaves no merchant, staff member or
-- preference behind.
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

-- The level: one choice, saved by the owner or permitted staff only, push switch kept in step.
CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', p_user::text, true), set_config('request.jwt.claim.role', 'authenticated', true);
$$;
SELECT pg_temp.as_user('c4a72000-0000-4000-8000-0000000000a1');
SET LOCAL ROLE authenticated;
DO $$ DECLARE m uuid := 'c4a72000-0000-4000-8000-0000000000b1'; v text; BEGIN
  v := public.set_chat_message_alert_level(m, 'handover');
  IF v <> 'handover' THEN RAISE EXCEPTION 'owner could not choose handover only: %', v; END IF;
  v := public.get_chat_message_alert_level(m);
  IF v <> 'handover' THEN RAISE EXCEPTION 'owner read back %', v; END IF;
  BEGIN PERFORM public.set_chat_message_alert_level(m, 'sometimes'); RAISE EXCEPTION 'unknown level accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.set_chat_message_alert_level(m, NULL); RAISE EXCEPTION 'null level accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT chat_message_push_enabled FROM public.notification_preferences WHERE merchant_id = 'c4a72000-0000-4000-8000-0000000000b1') IS NOT TRUE THEN RAISE EXCEPTION 'push switch off at handover only'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE m uuid := 'c4a72000-0000-4000-8000-0000000000b1'; BEGIN
  PERFORM public.set_chat_message_alert_level(m, 'off');
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT chat_message_notifications || ':' || chat_message_push_enabled FROM public.notification_preferences WHERE merchant_id = 'c4a72000-0000-4000-8000-0000000000b1') <> 'off:false' THEN RAISE EXCEPTION 'off did not turn the push switch off'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE m uuid := 'c4a72000-0000-4000-8000-0000000000b1'; BEGIN
  -- Choosing a level again undoes an older push-only mute.
  PERFORM public.set_chat_message_alert_level(m, 'all');
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT chat_message_notifications || ':' || chat_message_push_enabled FROM public.notification_preferences WHERE merchant_id = 'c4a72000-0000-4000-8000-0000000000b1') <> 'all:true' THEN RAISE EXCEPTION 'all did not turn the push switch back on'; END IF;
END $$;
-- Staff with the permission may save and read; staff without it and outsiders may not.
SELECT pg_temp.as_user('c4a72000-0000-4000-8000-0000000000a3');
SET LOCAL ROLE authenticated;
DO $$ DECLARE m uuid := 'c4a72000-0000-4000-8000-0000000000b1'; v text; BEGIN
  v := public.set_chat_message_alert_level(m, 'handover');
  IF v <> 'handover' THEN RAISE EXCEPTION 'permitted staff refused: %', v; END IF;
  v := public.get_chat_message_alert_level(m);
  IF v <> 'handover' THEN RAISE EXCEPTION 'permitted staff read back %', v; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.as_user('c4a72000-0000-4000-8000-0000000000a4');
SET LOCAL ROLE authenticated;
DO $$ DECLARE m uuid := 'c4a72000-0000-4000-8000-0000000000b1'; BEGIN
  BEGIN PERFORM public.set_chat_message_alert_level(m, 'off'); RAISE EXCEPTION 'staff without settings.edit could save';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_chat_message_alert_level(m); RAISE EXCEPTION 'staff without dashboard.view could read';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.as_user('c4a72000-0000-4000-8000-0000000000a2');
SET LOCAL ROLE authenticated;
DO $$ DECLARE m uuid := 'c4a72000-0000-4000-8000-0000000000b1'; BEGIN
  BEGIN PERFORM public.set_chat_message_alert_level(m, 'off'); RAISE EXCEPTION 'an outsider could save';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_chat_message_alert_level(m); RAISE EXCEPTION 'an outsider could read';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.get_chat_message_alert_level('c4a72000-0000-4000-8000-0000000000b1'); RAISE EXCEPTION 'anon could read the level';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.set_chat_message_alert_level('c4a72000-0000-4000-8000-0000000000b1', 'off'); RAISE EXCEPTION 'anon could save the level';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

ROLLBACK;
