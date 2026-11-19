-- REGRESSION TEST: shared-cart change notices are sent at write time and the
-- sweep publisher acknowledges what production realtime.send really stores.
-- Run only in an empty disposable PostgreSQL database, using psql from this
-- directory (never against production):
--   psql -X -v ON_ERROR_STOP=1 -d cart_test \
--     -f supabase/tests/commerce_cart_publish_on_write.sql
--
-- The realtime.send stand-in below mirrors the production function: it adds
-- an `id` key to a payload that has none and turns a failed insert into a
-- warning. The first assertion fails against the pre-fix publisher, which
-- compared the stored payload to the id-less one it sent.

\set ON_ERROR_STOP on
BEGIN;

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; END IF; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;

\ir ../migrations/20261012050000_commerce_cart_core.sql
\ir ../migrations/20261012050100_commerce_cart_roles.sql

CREATE TABLE public.merchants (id uuid PRIMARY KEY, premium_features jsonb);
INSERT INTO public.merchants VALUES
  ('11111111-1111-4111-8111-111111111111', '["shared_cart","shared_cart_realtime"]'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '["shared_cart"]');
INSERT INTO public.commerce_carts (id, merchant_id, state, expires_at) VALUES
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'active', now() + interval '7 days'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active', now() + interval '7 days');

CREATE SCHEMA realtime;
CREATE TABLE realtime.messages (
  id uuid, topic text, event text, payload jsonb,
  extension text DEFAULT 'broadcast', private boolean,
  inserted_at timestamp NOT NULL DEFAULT now()
);
-- Row security as in production: the cart roles may never touch messages
-- directly (policies come from the broadcast migration below).
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic', true) $$;
-- Production-shaped stand-in (see the header).
CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE generated_id uuid; final_payload jsonb;
BEGIN
  BEGIN
    generated_id := gen_random_uuid();
    IF payload ? 'id' THEN final_payload := payload;
    ELSE final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    END IF;
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);
    IF current_setting('cart.test.send_mode', true) = 'drop' THEN
      RAISE EXCEPTION 'no partition of relation "messages" found for row';
    END IF;
    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)
    VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'WarnSendingBroadcastMessage: %', SQLERRM;
  END;
  IF current_setting('cart.test.send_mode', true) = 'throw' THEN
    RAISE EXCEPTION 'realtime unavailable';
  END IF;
END;
$$;

\ir ../migrations/20261014070000_commerce_cart_broadcast.sql

-- Before the fix: a notice queued for a live-update merchant can never be
-- acknowledged, because the stored payload carries the added id.
INSERT INTO public.commerce_cart_events (merchant_id, cart_id, version, operation_id, expires_at)
VALUES ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 1, 'op-1', now() + interval '1 day');
SELECT public.commerce_cart_publish_events(10, 'pre-fix');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.commerce_cart_events WHERE version = 1 AND delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'fixture no longer reproduces the production acknowledgement failure';
  END IF;
END $$;

-- Supabase grants EXECUTE on new functions to the API roles by default, so
-- the migration's REVOKEs below are what the privilege assertions measure.
CREATE SCHEMA IF NOT EXISTS private;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA private GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

\ir ../migrations/20261110130000_commerce_cart_publish_on_write.sql

-- 1. The fixed sweep delivers the notice the old publisher kept failing.
UPDATE public.commerce_cart_events SET next_attempt_at = now() WHERE version = 1;
DO $$ DECLARE v jsonb; BEGIN
  v := public.commerce_cart_publish_events(10, 'sweep');
  IF (v ->> 'sent')::int <> 1 OR (v ->> 'failed')::int <> 0 THEN
    RAISE EXCEPTION 'sweep did not deliver the queued notice: %', v;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.commerce_cart_events WHERE version = 1 AND delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'sweep did not acknowledge the delivered notice';
  END IF;
END $$;

-- 2. A cart write for a live-update merchant sends at write time.
INSERT INTO public.commerce_cart_events (merchant_id, cart_id, version, operation_id, payload, expires_at)
VALUES ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 2, 'op-2', '{"secret":"must-not-broadcast"}', now() + interval '1 day');
DO $$ DECLARE v_payload jsonb; BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.commerce_cart_events WHERE version = 2 AND delivered_at IS NOT NULL AND attempts = 0) THEN
    RAISE EXCEPTION 'write-time send was not acknowledged on the outbox row';
  END IF;
  IF (SELECT count(*) FROM realtime.messages WHERE payload ->> 'operationId' = 'op-2') <> 1 THEN
    RAISE EXCEPTION 'write-time send did not store exactly one notice';
  END IF;
  SELECT payload INTO v_payload FROM realtime.messages WHERE payload ->> 'operationId' = 'op-2';
  IF v_payload - 'id' <> jsonb_build_object(
      'merchantId', '11111111-1111-4111-8111-111111111111',
      'cartId', '22222222-2222-4222-8222-222222222222',
      'version', 2, 'operationId', 'op-2')
    OR NOT (v_payload ? 'id') THEN
    RAISE EXCEPTION 'notice payload is not the routing hint: %', v_payload;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM realtime.messages WHERE payload ->> 'operationId' = 'op-2'
      AND private IS TRUE AND event = 'cart_changed'
      AND topic = 'cart:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222') THEN
    RAISE EXCEPTION 'notice was not sent privately on the cart topic';
  END IF;
END $$;
-- The sweep must not send it a second time.
SELECT public.commerce_cart_publish_events(10, 'sweep');
DO $$ BEGIN
  IF (SELECT count(*) FROM realtime.messages WHERE payload ->> 'operationId' = 'op-2') <> 1 THEN
    RAISE EXCEPTION 'sweep re-sent a notice already delivered at write time';
  END IF;
END $$;

-- 3. A merchant without live updates gets no notice, at write time or later.
INSERT INTO public.commerce_cart_events (merchant_id, cart_id, version, operation_id, expires_at)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1, 'op-other', now() + interval '1 day');
SELECT public.commerce_cart_publish_events(10, 'sweep');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM realtime.messages WHERE payload ->> 'operationId' = 'op-other')
    OR EXISTS (SELECT 1 FROM public.commerce_cart_events WHERE operation_id = 'op-other' AND delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'notice sent for a merchant without live updates';
  END IF;
END $$;

-- 4. A silently dropped send (missing daily partition) never fails the cart
--    write; the row stays queued and the sweep delivers it once sends work.
SELECT set_config('cart.test.send_mode', 'drop', true);
INSERT INTO public.commerce_cart_events (merchant_id, cart_id, version, operation_id, expires_at)
VALUES ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 3, 'op-3', now() + interval '1 day');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.commerce_cart_events WHERE version = 3 AND delivered_at IS NULL AND attempts = 0) THEN
    RAISE EXCEPTION 'dropped write-time send was acknowledged or the write was lost';
  END IF;
END $$;
SELECT public.commerce_cart_publish_events(10, 'sweep');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.commerce_cart_events WHERE version = 3 AND delivered_at IS NULL AND attempts = 1 AND next_attempt_at > now()) THEN
    RAISE EXCEPTION 'dropped sweep send was not backed off for retry';
  END IF;
END $$;
SELECT set_config('cart.test.send_mode', '', true);
UPDATE public.commerce_cart_events SET next_attempt_at = now() WHERE version = 3;
SELECT public.commerce_cart_publish_events(10, 'sweep');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.commerce_cart_events WHERE version = 3 AND delivered_at IS NOT NULL)
    OR (SELECT count(*) FROM realtime.messages WHERE payload ->> 'operationId' = 'op-3') <> 1 THEN
    RAISE EXCEPTION 'sweep did not recover the dropped notice exactly once';
  END IF;
END $$;

-- 5. A send that raises never fails the cart write either.
SELECT set_config('cart.test.send_mode', 'throw', true);
INSERT INTO public.commerce_cart_events (merchant_id, cart_id, version, operation_id, expires_at)
VALUES ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 4, 'op-4', now() + interval '1 day');
SELECT set_config('cart.test.send_mode', '', true);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.commerce_cart_events WHERE version = 4 AND delivered_at IS NULL) THEN
    RAISE EXCEPTION 'a raising send broke the cart write or was acknowledged';
  END IF;
  -- The failed attempt's message insert rolled back with its savepoint.
  IF EXISTS (SELECT 1 FROM realtime.messages WHERE payload ->> 'operationId' = 'op-4') THEN
    RAISE EXCEPTION 'a failed write-time send left a stray notice';
  END IF;
END $$;

-- 6. A rolled-back cart write sends nothing.
SAVEPOINT cart_write;
INSERT INTO public.commerce_cart_events (merchant_id, cart_id, version, operation_id, expires_at)
VALUES ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 5, 'op-5', now() + interval '1 day');
ROLLBACK TO cart_write;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM realtime.messages WHERE payload ->> 'operationId' = 'op-5') THEN
    RAISE EXCEPTION 'a rolled-back cart write still sent a notice';
  END IF;
END $$;

-- 6b. A shopper-role cart write (through a definer cart function, as in
--     production) still sends, although the shopper role itself is denied
--     any direct access to realtime.messages.
CREATE FUNCTION public.test_cart_write(p_version integer, p_op text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.commerce_cart_events (merchant_id, cart_id, version, operation_id, expires_at)
  VALUES ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', p_version, p_op, now() + interval '1 day');
$$;
GRANT EXECUTE ON FUNCTION public.test_cart_write(integer, text) TO commerce_cart_shopper;
SET LOCAL ROLE commerce_cart_shopper;
SELECT public.test_cart_write(6, 'op-6');
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM realtime.messages;
    RAISE EXCEPTION 'shopper role read realtime.messages directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.commerce_cart_events WHERE version = 6 AND delivered_at IS NOT NULL)
    OR (SELECT count(*) FROM realtime.messages WHERE payload ->> 'operationId' = 'op-6') <> 1 THEN
    RAISE EXCEPTION 'shopper-role cart write did not send its notice';
  END IF;
END $$;

-- 6c. An already-expired notice is not sent at write time, as in the sweep.
INSERT INTO public.commerce_cart_events (merchant_id, cart_id, version, operation_id, expires_at)
VALUES ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 7, 'op-7', now() - interval '1 minute');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM realtime.messages WHERE payload ->> 'operationId' = 'op-7')
    OR EXISTS (SELECT 1 FROM public.commerce_cart_events WHERE version = 7 AND delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'an expired notice was sent at write time';
  END IF;
END $$;

-- 7. Health reading: stale and dead-lettered notices are counted, and only
--    for live-update merchants.
DO $$ DECLARE v jsonb; BEGIN
  v := public.commerce_cart_publish_health();
  IF (v ->> 'healthy')::boolean IS NOT TRUE OR v ? 'delivered24h' THEN
    RAISE EXCEPTION 'fresh queue should read healthy: %', v;
  END IF;
  UPDATE public.commerce_cart_events SET created_at = now() - interval '6 minutes' WHERE version = 4;
  UPDATE public.commerce_cart_events SET created_at = now() - interval '6 minutes' WHERE operation_id = 'op-other';
  v := public.commerce_cart_publish_health();
  IF (v ->> 'healthy')::boolean IS NOT FALSE OR (v ->> 'staleUndelivered')::int <> 1 THEN
    RAISE EXCEPTION 'stale notice not reported: %', v;
  END IF;
  UPDATE public.commerce_cart_events SET dead_letter_at = now() WHERE version = 4;
  v := public.commerce_cart_publish_health();
  IF (v ->> 'staleUndelivered')::int <> 0 OR (v ->> 'deadLettered24h')::int <> 1 OR (v ->> 'healthy')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'dead-lettered notice not reported: %', v;
  END IF;
  -- Unenrolling the merchant clears its share of the alarm at once.
  UPDATE public.merchants SET premium_features = '["shared_cart"]' WHERE id = '11111111-1111-4111-8111-111111111111';
  v := public.commerce_cart_publish_health();
  IF (v ->> 'healthy')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'unenrolled merchant still trips the alarm: %', v;
  END IF;
END $$;

-- 8. Privileges, asserted through the catalog.
DO $$ BEGIN
  IF has_function_privilege('anon', 'private.commerce_cart_send_change(uuid,uuid,integer,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'private.commerce_cart_send_change(uuid,uuid,integer,text)', 'EXECUTE')
    OR has_function_privilege('service_role', 'private.commerce_cart_send_change(uuid,uuid,integer,text)', 'EXECUTE')
    OR has_function_privilege('commerce_cart_shopper', 'private.commerce_cart_send_change(uuid,uuid,integer,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'private.commerce_cart_events_send_on_write()', 'EXECUTE')
    OR has_function_privilege('service_role', 'private.commerce_cart_events_send_on_write()', 'EXECUTE') THEN
    RAISE EXCEPTION 'a client role can call the private sender';
  END IF;
  IF has_function_privilege('anon', 'public.commerce_cart_publish_events(integer,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.commerce_cart_publish_events(integer,text)', 'EXECUTE')
    OR has_function_privilege('commerce_cart_shopper', 'public.commerce_cart_publish_events(integer,text)', 'EXECUTE')
    OR has_function_privilege('commerce_cart_receiver', 'public.commerce_cart_publish_events(integer,text)', 'EXECUTE')
    OR NOT has_function_privilege('commerce_cart_worker', 'public.commerce_cart_publish_events(integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'publisher execute grants changed';
  END IF;
  IF NOT has_function_privilege('anon', 'public.commerce_cart_publish_health()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.commerce_cart_publish_health()', 'EXECUTE') THEN
    RAISE EXCEPTION 'health reading grants are wrong';
  END IF;
END $$;

ROLLBACK;
