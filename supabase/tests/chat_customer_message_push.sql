-- Behaviour of the chat push wrappers. Runs in one transaction and rolls
-- back: it leaves no merchant, secret, token or push record behind.
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('c4a71000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-push-owner@example.invalid'),
  ('c4a71000-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-push-other-owner@example.invalid'),
  ('c4a71000-0000-4000-8000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-push-outsider@example.invalid'),
  ('c4a71000-0000-4000-8000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-push-staff-allowed@example.invalid'),
  ('c4a71000-0000-4000-8000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-push-staff-denied@example.invalid'),
  ('c4a71000-0000-4000-8000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'chat-push-staff-inactive@example.invalid');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.merchants (id, user_id, email, business_name, slug, country, payout_currency) VALUES
  ('c4a71000-0000-4000-8000-0000000000b1', 'c4a71000-0000-4000-8000-0000000000a1', 'chat-push-owner@example.invalid', 'Synthetic Chat Push Store', 'synthetic-chat-push', 'NG', 'NGN'),
  ('c4a71000-0000-4000-8000-0000000000b2', 'c4a71000-0000-4000-8000-0000000000a2', 'chat-push-other-owner@example.invalid', 'Synthetic Chat Push Store Two', 'synthetic-chat-push-two', 'NG', 'NGN');
-- Staff: one allowed to view customers, one explicitly not, one allowed but inactive.
INSERT INTO public.staff_members (merchant_id, user_id, email, role, permissions, status) VALUES
  ('c4a71000-0000-4000-8000-0000000000b1', 'c4a71000-0000-4000-8000-0000000000a4', 'chat-push-staff-allowed@example.invalid', 'blog_manager', '{"customers":{"view":true}}'::jsonb, 'active'),
  ('c4a71000-0000-4000-8000-0000000000b1', 'c4a71000-0000-4000-8000-0000000000a5', 'chat-push-staff-denied@example.invalid', 'blog_manager', '{"customers":{"view":false}}'::jsonb, 'active'),
  ('c4a71000-0000-4000-8000-0000000000b1', 'c4a71000-0000-4000-8000-0000000000a6', 'chat-push-staff-inactive@example.invalid', 'blog_manager', '{"customers":{"view":true}}'::jsonb, 'suspended');
RESET ROLE;
SELECT set_config('request.jwt.claim.role', '', true);

INSERT INTO public.push_tokens (user_id, merchant_id, token, platform, is_active, app_type) VALUES
  ('c4a71000-0000-4000-8000-0000000000a1', 'c4a71000-0000-4000-8000-0000000000b1', 'ExponentPushToken[synthetic-owner-ios]', 'ios', true, 'admin'),
  ('c4a71000-0000-4000-8000-0000000000a1', 'c4a71000-0000-4000-8000-0000000000b1', 'ExponentPushToken[synthetic-owner-old]', 'android', false, 'admin'),
  ('c4a71000-0000-4000-8000-0000000000a1', 'c4a71000-0000-4000-8000-0000000000b1', 'ExponentPushToken[synthetic-owner-shopper]', 'ios', true, 'storefront'),
  ('c4a71000-0000-4000-8000-0000000000a3', 'c4a71000-0000-4000-8000-0000000000b1', 'ExponentPushToken[synthetic-outsider]', 'ios', true, 'admin'),
  ('c4a71000-0000-4000-8000-0000000000a2', 'c4a71000-0000-4000-8000-0000000000b2', 'ExponentPushToken[synthetic-other-store]', 'ios', true, 'admin'),
  ('c4a71000-0000-4000-8000-0000000000a4', 'c4a71000-0000-4000-8000-0000000000b1', 'ExponentPushToken[synthetic-staff-allowed]', 'android', true, 'admin'),
  ('c4a71000-0000-4000-8000-0000000000a5', 'c4a71000-0000-4000-8000-0000000000b1', 'ExponentPushToken[synthetic-staff-denied]', 'android', true, 'admin'),
  ('c4a71000-0000-4000-8000-0000000000a6', 'c4a71000-0000-4000-8000-0000000000b1', 'ExponentPushToken[synthetic-staff-inactive]', 'android', true, 'admin');

DELETE FROM private.chat_event_server_secrets;
INSERT INTO private.chat_event_server_secrets(secret_name, secret) VALUES ('current', 'synthetic-chat-event-secret-0123456789abcdef');

CREATE FUNCTION pg_temp.push_proof(p_key text, p_claim uuid, p_action text, p_merchant uuid DEFAULT 'c4a71000-0000-4000-8000-0000000000b1', p_secret text DEFAULT 'synthetic-chat-event-secret-0123456789abcdef', p_age integer DEFAULT 0)
RETURNS text LANGUAGE sql AS $$
  SELECT encode(extensions.hmac(concat_ws('|', 'chat-event-push:v1', (extract(epoch FROM now())::bigint - p_age)::text, p_merchant::text, p_key, p_claim::text, p_action), p_secret, 'sha256'), 'hex');
$$;
CREATE FUNCTION pg_temp.at(p_age integer DEFAULT 0) RETURNS bigint LANGUAGE sql AS $$ SELECT extract(epoch FROM now())::bigint - p_age; $$;

-- One notified event and one muted event for the store.
INSERT INTO public.chat_message_events(merchant_id, event_key, conversation_id, outcome) VALUES
  ('c4a71000-0000-4000-8000-0000000000b1', 'evt-push-0001', 7, 'notified'),
  ('c4a71000-0000-4000-8000-0000000000b1', 'evt-push-muted', 8, 'muted'),
  ('c4a71000-0000-4000-8000-0000000000b2', 'evt-push-0001', 7, 'notified');

DO $$
DECLARE
  m uuid := 'c4a71000-0000-4000-8000-0000000000b1';
  claim uuid := 'c4a71000-0000-4000-8000-0000000000c1';
  other_claim uuid := 'c4a71000-0000-4000-8000-0000000000c2';
  v_tokens text[];
BEGIN
  -- A forged or stale proof takes no claim.
  BEGIN PERFORM public.chat_event_claim_push(pg_temp.push_proof('evt-push-0001', claim, 'claim', p_secret => 'another-secret-another-secret-another-0000'), pg_temp.at(), m, 'evt-push-0001', claim);
    RAISE EXCEPTION 'forged claim accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_invalid' THEN RAISE; END IF; END;
  BEGIN PERFORM public.chat_event_claim_push(pg_temp.push_proof('evt-push-0001', claim, 'claim', p_age => 301), pg_temp.at(301), m, 'evt-push-0001', claim);
    RAISE EXCEPTION 'stale claim accepted';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_expired' THEN RAISE; END IF; END;
  -- A proof made for one action cannot be used for another.
  BEGIN PERFORM public.chat_event_claim_push(pg_temp.push_proof('evt-push-0001', claim, 'tokens'), pg_temp.at(), m, 'evt-push-0001', claim);
    RAISE EXCEPTION 'proof reused across actions';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'chat_event_proof_invalid' THEN RAISE; END IF; END;
  IF EXISTS (SELECT 1 FROM public.chat_message_events WHERE push_claim IS NOT NULL AND merchant_id IN ('c4a71000-0000-4000-8000-0000000000b1', 'c4a71000-0000-4000-8000-0000000000b2')) THEN RAISE EXCEPTION 'a refused claim was taken'; END IF;

  -- Without a claim nothing is readable or writable.
  IF EXISTS (SELECT 1 FROM public.chat_event_push_tokens(pg_temp.push_proof('evt-push-0001', claim, 'tokens'), pg_temp.at(), m, 'evt-push-0001', claim)) THEN
    RAISE EXCEPTION 'tokens returned without a claim';
  END IF;

  -- A muted event can never be claimed; a notified one exactly once.
  IF public.chat_event_claim_push(pg_temp.push_proof('evt-push-muted', claim, 'claim'), pg_temp.at(), m, 'evt-push-muted', claim) THEN
    RAISE EXCEPTION 'muted event claimed for push';
  END IF;
  IF NOT public.chat_event_claim_push(pg_temp.push_proof('evt-push-0001', claim, 'claim'), pg_temp.at(), m, 'evt-push-0001', claim) THEN
    RAISE EXCEPTION 'first claim refused';
  END IF;
  IF public.chat_event_claim_push(pg_temp.push_proof('evt-push-0001', other_claim, 'claim'), pg_temp.at(), m, 'evt-push-0001', other_claim) THEN
    RAISE EXCEPTION 'second claim accepted: a redelivery would push twice';
  END IF;

  -- Only the store's active merchant-app tokens of eligible users: the owner
  -- and active staff allowed to view customers.
  SELECT array_agg(t.token ORDER BY t.token) INTO v_tokens
  FROM public.chat_event_push_tokens(pg_temp.push_proof('evt-push-0001', claim, 'tokens'), pg_temp.at(), m, 'evt-push-0001', claim) t;
  IF v_tokens IS DISTINCT FROM ARRAY['ExponentPushToken[synthetic-owner-ios]', 'ExponentPushToken[synthetic-staff-allowed]'] THEN
    RAISE EXCEPTION 'unexpected tokens: %', v_tokens;
  END IF;
  -- The temporary role claim used for the staff lookup does not leak out.
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> '' THEN
    RAISE EXCEPTION 'role claim left raised after the recipient lookup';
  END IF;
  -- The losing claim sees nothing.
  IF EXISTS (SELECT 1 FROM public.chat_event_push_tokens(pg_temp.push_proof('evt-push-0001', other_claim, 'tokens'), pg_temp.at(), m, 'evt-push-0001', other_claim)) THEN
    RAISE EXCEPTION 'tokens returned for a claim that was not granted';
  END IF;

  -- Tickets: only this store's merchant-app tokens are stored.
  IF NOT public.chat_event_store_push_tickets(pg_temp.push_proof('evt-push-0001', claim, 'tickets'), pg_temp.at(), m, 'evt-push-0001', claim,
    '[{"ticket_id":"synthetic-ticket-1","push_token":"ExponentPushToken[synthetic-owner-ios]"},
      {"ticket_id":"synthetic-ticket-2","push_token":"ExponentPushToken[synthetic-other-store]"},
      {"ticket_id":"synthetic-ticket-3","push_token":"ExponentPushToken[synthetic-owner-shopper]"},
      {"ticket_id":"","push_token":"ExponentPushToken[synthetic-owner-ios]"}]'::jsonb) THEN
    RAISE EXCEPTION 'tickets refused';
  END IF;
  -- Storing the same tickets again (a retried step) succeeds and adds nothing.
  IF NOT public.chat_event_store_push_tickets(pg_temp.push_proof('evt-push-0001', claim, 'tickets'), pg_temp.at(), m, 'evt-push-0001', claim,
    '[{"ticket_id":"synthetic-ticket-1","push_token":"ExponentPushToken[synthetic-owner-ios]"}]'::jsonb) THEN
    RAISE EXCEPTION 'retried tickets refused';
  END IF;
  IF (SELECT array_agg(ticket_id ORDER BY ticket_id) FROM public.push_notification_tickets WHERE ticket_id LIKE 'synthetic-ticket-%')
    IS DISTINCT FROM ARRAY['synthetic-ticket-1'] THEN
    RAISE EXCEPTION 'tickets stored for tokens outside the store';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.push_notification_tickets WHERE ticket_id = 'synthetic-ticket-1'
    AND merchant_id = m AND app_type = 'admin' AND notification_type = 'customer_message' AND status = 'pending') THEN
    RAISE EXCEPTION 'ticket row has unexpected scope';
  END IF;

  -- Deactivation: another store's token is untouched.
  IF NOT public.chat_event_deactivate_push_tokens(pg_temp.push_proof('evt-push-0001', claim, 'deactivate'), pg_temp.at(), m, 'evt-push-0001', claim,
    'DeviceNotRegistered', ARRAY['ExponentPushToken[synthetic-owner-ios]', 'ExponentPushToken[synthetic-other-store]', 'ExponentPushToken[synthetic-owner-shopper]']) THEN
    RAISE EXCEPTION 'deactivation refused';
  END IF;
  IF (SELECT is_active FROM public.push_tokens WHERE token = 'ExponentPushToken[synthetic-owner-ios]')
    OR NOT (SELECT is_active FROM public.push_tokens WHERE token = 'ExponentPushToken[synthetic-other-store]')
    OR NOT (SELECT is_active FROM public.push_tokens WHERE token = 'ExponentPushToken[synthetic-owner-shopper]') THEN
    RAISE EXCEPTION 'deactivation reached outside the store merchant app';
  END IF;

  -- Attempt log: fixed wording, never the customer text supplied by the caller.
  IF NOT public.chat_event_record_push_attempt(pg_temp.push_proof('evt-push-0001', claim, 'attempt'), pg_temp.at(), m, 'evt-push-0001', claim,
    '{"status":"sent","token_count":1,"sent_count":1,"failed_count":0,"title":"New message from Ada","body":"my card number is 1234","errors":[]}'::jsonb) THEN
    RAISE EXCEPTION 'attempt refused';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.push_notification_attempts WHERE merchant_id = m AND notification_type = 'customer_message'
    AND app_type = 'admin' AND status = 'sent' AND token_count = 1 AND sent_count = 1
    AND title = 'New customer message' AND body = 'A customer sent a message to your store.'
    AND payload = '{"type":"customer_message","event_key":"evt-push-0001","handover":false}'::jsonb) THEN
    RAISE EXCEPTION 'attempt row is not the fixed, scoped record';
  END IF;
  BEGIN PERFORM public.chat_event_record_push_attempt(pg_temp.push_proof('evt-push-0001', claim, 'attempt'), pg_temp.at(), m, 'evt-push-0001', claim, '{"status":"whatever"}'::jsonb);
    RAISE EXCEPTION 'unknown attempt status accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  -- Malformed counts are refused with the same error, not a cast failure.
  BEGIN PERFORM public.chat_event_record_push_attempt(pg_temp.push_proof('evt-push-0001', claim, 'attempt'), pg_temp.at(), m, 'evt-push-0001', claim, '{"status":"sent","token_count":"many"}'::jsonb);
    RAISE EXCEPTION 'non-numeric count accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.chat_event_record_push_attempt(pg_temp.push_proof('evt-push-0001', claim, 'attempt'), pg_temp.at(), m, 'evt-push-0001', claim, '{"status":"sent","sent_count":99999999999}'::jsonb);
    RAISE EXCEPTION 'out-of-range count accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- The claim on this store's key gives nothing on the other store's same key.
  IF EXISTS (SELECT 1 FROM public.chat_event_push_tokens(pg_temp.push_proof('evt-push-0001', claim, 'tokens', p_merchant => 'c4a71000-0000-4000-8000-0000000000b2'), pg_temp.at(), 'c4a71000-0000-4000-8000-0000000000b2', 'evt-push-0001', claim)) THEN
    RAISE EXCEPTION 'claim crossed stores';
  END IF;

  -- A claim stops working after ten minutes.
  UPDATE public.chat_message_events SET push_claimed_at = now() - interval '11 minutes' WHERE merchant_id = m AND event_key = 'evt-push-0001';
  IF public.chat_event_record_push_attempt(pg_temp.push_proof('evt-push-0001', claim, 'attempt'), pg_temp.at(), m, 'evt-push-0001', claim, '{"status":"sent"}'::jsonb) THEN
    RAISE EXCEPTION 'expired claim still accepted';
  END IF;
END $$;

-- The public API role can use the wrappers with a proof; a signed-in user cannot call them.
UPDATE public.chat_message_events SET push_claim = NULL, push_claimed_at = NULL WHERE merchant_id = 'c4a71000-0000-4000-8000-0000000000b1' AND event_key = 'evt-push-0001';
SELECT set_config('test.at', pg_temp.at()::text, true);
SELECT set_config('test.proof', pg_temp.push_proof('evt-push-0001', 'c4a71000-0000-4000-8000-0000000000c3', 'claim'), true);
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF NOT public.chat_event_claim_push(current_setting('test.proof'), current_setting('test.at')::bigint, 'c4a71000-0000-4000-8000-0000000000b1', 'evt-push-0001', 'c4a71000-0000-4000-8000-0000000000c3') THEN
    RAISE EXCEPTION 'anon could not claim with a valid proof';
  END IF;
  BEGIN PERFORM 1 FROM public.push_tokens LIMIT 1;
    RAISE EXCEPTION 'anon could read push tokens directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.chat_event_claim_push(current_setting('test.proof'), current_setting('test.at')::bigint, 'c4a71000-0000-4000-8000-0000000000b1', 'evt-push-0001', 'c4a71000-0000-4000-8000-0000000000c3');
    RAISE EXCEPTION 'a signed-in user could call the push wrappers';
  EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM LIKE 'chat_event%' THEN RAISE EXCEPTION 'signed-in call reached the function body'; END IF; END;
END $$;
RESET ROLE;

ROLLBACK;
