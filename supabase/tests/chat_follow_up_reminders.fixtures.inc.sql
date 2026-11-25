-- Include-only part of chat_follow_up_reminders.sql and
-- chat_follow_up_reminder_sweep.sql (no BEGIN/ROLLBACK): each entry point owns
-- the transaction and loads this file with \ir. Synthetic users, two stores,
-- staff, the chat-event secret and the proof helpers.

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('c4a73000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'follow-up-owner@example.invalid'),
  ('c4a73000-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'follow-up-outsider@example.invalid'),
  ('c4a73000-0000-4000-8000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'follow-up-staff-editor@example.invalid'),
  ('c4a73000-0000-4000-8000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'follow-up-staff-viewer@example.invalid'),
  ('c4a73000-0000-4000-8000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'follow-up-other-owner@example.invalid');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug, country, payout_currency) VALUES
  ('c4a73000-0000-4000-8000-0000000000b1', 'c4a73000-0000-4000-8000-0000000000a1', 'follow-up-owner@example.invalid', 'Synthetic Follow Up Store', 'synthetic-follow-up', 'NG', 'NGN'),
  ('c4a73000-0000-4000-8000-0000000000b2', 'c4a73000-0000-4000-8000-0000000000a5', 'follow-up-other-owner@example.invalid', 'Synthetic Follow Up Store Two', 'synthetic-follow-up-two', 'NG', 'NGN');
INSERT INTO public.staff_members (merchant_id, user_id, email, role, permissions, status) VALUES
  ('c4a73000-0000-4000-8000-0000000000b1', 'c4a73000-0000-4000-8000-0000000000a3', 'follow-up-staff-editor@example.invalid', 'blog_manager', '{"customers":{"view":true,"edit":true}}'::jsonb, 'active'),
  ('c4a73000-0000-4000-8000-0000000000b1', 'c4a73000-0000-4000-8000-0000000000a4', 'follow-up-staff-viewer@example.invalid', 'blog_manager', '{"customers":{"view":true,"edit":false}}'::jsonb, 'active');
RESET ROLE;
SELECT set_config('request.jwt.claim.role', '', true);

DELETE FROM private.chat_event_server_secrets;
INSERT INTO private.chat_event_server_secrets(secret_name, secret) VALUES ('current', 'synthetic-chat-event-secret-0123456789abcdef');

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', p_user::text, true), set_config('request.jwt.claim.role', 'authenticated', true);
$$;
CREATE FUNCTION pg_temp.list_proof(p_secret text, p_issued_at bigint, p_limit integer) RETURNS text LANGUAGE sql AS $$
  SELECT encode(extensions.hmac(concat_ws('|', 'chat-follow-up-list:v1', p_issued_at::text, p_limit::text), p_secret, 'sha256'), 'hex');
$$;
CREATE FUNCTION pg_temp.record_proof(p_secret text, p_issued_at bigint, p_merchant uuid, p_reminder uuid, p_send boolean) RETURNS text LANGUAGE sql AS $$
  SELECT encode(extensions.hmac(concat_ws('|', 'chat-follow-up:v1', p_issued_at::text, p_merchant::text, p_reminder::text, p_send::text), p_secret, 'sha256'), 'hex');
$$;
CREATE FUNCTION pg_temp.due(p_limit integer DEFAULT 25, p_age integer DEFAULT 0, p_secret text DEFAULT 'synthetic-chat-event-secret-0123456789abcdef')
RETURNS SETOF public.chat_follow_up_reminders LANGUAGE sql AS $$
  SELECT r.* FROM public.list_due_chat_follow_up_reminders(
    pg_temp.list_proof(p_secret, extract(epoch FROM now())::bigint - p_age, p_limit),
    extract(epoch FROM now())::bigint - p_age, p_limit) l
  JOIN public.chat_follow_up_reminders r ON r.id = l.reminder_id;
$$;
CREATE FUNCTION pg_temp.take(p_reminder uuid, p_send boolean DEFAULT true, p_merchant uuid DEFAULT 'c4a73000-0000-4000-8000-0000000000b1', p_age integer DEFAULT 0, p_secret text DEFAULT 'synthetic-chat-event-secret-0123456789abcdef')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.record_chat_follow_up_reminder(
    pg_temp.record_proof(p_secret, extract(epoch FROM now())::bigint - p_age, p_merchant, p_reminder, p_send),
    extract(epoch FROM now())::bigint - p_age, p_merchant, p_reminder, p_send);
$$;
CREATE FUNCTION pg_temp.push_proof(p_key text, p_claim uuid, p_action text) RETURNS text LANGUAGE sql AS $$
  SELECT encode(extensions.hmac(concat_ws('|', 'chat-event-push:v1', extract(epoch FROM now())::bigint::text, 'c4a73000-0000-4000-8000-0000000000b1', p_key, p_claim::text, p_action),
    'synthetic-chat-event-secret-0123456789abcdef', 'sha256'), 'hex');
$$;
CREATE FUNCTION pg_temp.release(p_reminder uuid, p_merchant uuid DEFAULT 'c4a73000-0000-4000-8000-0000000000b1', p_secret text DEFAULT 'synthetic-chat-event-secret-0123456789abcdef')
RETURNS boolean LANGUAGE sql AS $$
  SELECT public.release_chat_follow_up_reminder(
    encode(extensions.hmac(concat_ws('|', 'chat-follow-up-release:v1', extract(epoch FROM now())::bigint::text, p_merchant::text, p_reminder::text), p_secret, 'sha256'), 'hex'),
    extract(epoch FROM now())::bigint, p_merchant, p_reminder);
$$;
