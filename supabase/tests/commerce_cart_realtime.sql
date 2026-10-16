-- REGRESSION TEST: shared server cart tenant/guest isolation.
-- Run only in an empty disposable PostgreSQL database, using psql from this
-- directory (never against production):
--   psql -X -v ON_ERROR_STOP=1 -h /tmp/baci-cart-sock -p 55433 -U postgres \
--     -d cart_test -f supabase/tests/commerce_cart_access.sql
--
-- Proves, with real roles and separate sessions, that only the dedicated
-- shopper role with a matching merchant/cart/grant claim can touch its own
-- cart rows, and that anon/authenticated/receiver roles plus forged,
-- expired or revoked claims are denied.

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

-- Unrelated private tables: the cart roles must never read these.
CREATE TABLE public.customers (id uuid PRIMARY KEY, email text);
CREATE TABLE public.orders (id uuid PRIMARY KEY, total_minor integer);
INSERT INTO public.customers VALUES ('99999999-9999-4999-8999-999999999999', 'shopper@example.com');
INSERT INTO public.orders VALUES ('88888888-8888-4888-8888-888888888888', 5000);

\ir ../migrations/20261012050000_commerce_cart_core.sql
\ir ../migrations/20261012050100_commerce_cart_roles.sql

-- Fixtures: merchants A/B, carts A1/A2/B1, guests A1/A2/B1.
INSERT INTO public.commerce_carts (id, merchant_id, state, expires_at) VALUES
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'active', now() + interval '7 days'),
  ('22222222-2222-4222-8222-222222222223', '11111111-1111-4111-8111-111111111111', 'active', now() + interval '7 days'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active', now() + interval '7 days');

INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at) VALUES
  ('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'guest-a1', now() + interval '7 days', NULL),
  ('66666666-6666-4666-8666-666666666667', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'guest-a1-old', now() - interval '1 hour', NULL),
  ('66666666-6666-4666-8666-666666666668', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'guest-a1-rev', now() + interval '7 days', now()),
  ('66666666-6666-4666-8666-666666666669', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222223', 'guest-a2', now() + interval '7 days', NULL),
  ('77777777-7777-4777-8777-777777777777', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'guest-b1', now() + interval '7 days', NULL);

CREATE TABLE public.merchants (id uuid PRIMARY KEY, premium_features jsonb);
INSERT INTO public.merchants VALUES ('11111111-1111-4111-8111-111111111111','["shared_cart","shared_cart_realtime"]');
CREATE SCHEMA realtime;
CREATE TABLE realtime.messages (id bigint GENERATED ALWAYS AS IDENTITY, topic text, event text, payload jsonb, extension text DEFAULT 'broadcast', private boolean);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
-- Legacy/public policies must never widen a dedicated receiver's authority.
GRANT SELECT,INSERT ON realtime.messages TO PUBLIC;
CREATE POLICY existing_public_read ON realtime.messages FOR SELECT TO PUBLIC USING (true);
CREATE POLICY existing_public_send ON realtime.messages FOR INSERT TO PUBLIC WITH CHECK (true);
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic',true) $$;
CREATE FUNCTION realtime.send(payload jsonb,event text,topic text,private boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('cart.test.drop_send',true) = 'true' THEN RETURN; END IF;
 INSERT INTO realtime.messages(topic,event,payload,private) VALUES ($3,$2,$1,$4);
END;
$$;
\ir ../migrations/20261014070000_commerce_cart_broadcast.sql
DO $$ BEGIN
 IF NOT pg_has_role('authenticator','commerce_cart_receiver','MEMBER') OR NOT pg_has_role('authenticator','commerce_cart_shopper','MEMBER') OR NOT pg_has_role('authenticator','commerce_cart_worker','MEMBER') THEN RAISE EXCEPTION 'authenticator cannot assume scoped cart roles'; END IF;
END $$;

SELECT set_config('request.jwt.claims', jsonb_build_object('role','commerce_cart_receiver','cart_scope','session','cart_id','22222222-2222-4222-8222-222222222222','cart_merchant_id','11111111-1111-4111-8111-111111111111','cart_grant_id','66666666-6666-4666-8666-666666666666','cart_principal_id','guest-a1','exp',extract(epoch FROM now()+interval '5 minutes'))::text,true);
DO $$ BEGIN
 IF NOT public.commerce_cart_receive_authorized('cart:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222') THEN RAISE EXCEPTION 'live guest must receive its exact topic'; END IF;
 IF public.commerce_cart_receive_authorized('cart:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') THEN RAISE EXCEPTION 'foreign tenant allowed'; END IF;
 IF public.commerce_cart_receive_authorized('cart:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222223') THEN RAISE EXCEPTION 'foreign guest cart allowed'; END IF;
END $$;
-- The broader shopper role must not satisfy receive authorization
-- directly (20261015165000): only the receive-only token subscribes.
\ir ../migrations/20261015165000_commerce_cart_receive_receiver_only.sql
SELECT set_config('request.jwt.claims', jsonb_build_object('role','commerce_cart_shopper','cart_scope','session','cart_id','22222222-2222-4222-8222-222222222222','cart_merchant_id','11111111-1111-4111-8111-111111111111','cart_grant_id','66666666-6666-4666-8666-666666666666','cart_principal_id','guest-a1','exp',extract(epoch FROM now()+interval '5 minutes'))::text,true);
DO $$ BEGIN
 IF public.commerce_cart_receive_authorized('cart:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222') THEN RAISE EXCEPTION 'shopper role must not receive directly'; END IF;
END $$;
SELECT set_config('request.jwt.claims', jsonb_build_object('role','commerce_cart_receiver','cart_scope','session','cart_id','22222222-2222-4222-8222-222222222222','cart_merchant_id','11111111-1111-4111-8111-111111111111','cart_grant_id','66666666-6666-4666-8666-666666666666','cart_principal_id','guest-a1','exp',extract(epoch FROM now()+interval '5 minutes'))::text,true);
INSERT INTO realtime.messages(topic,event,payload,private) VALUES ('cart:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222','cart_changed','{}',true),('cart:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222223','cart_changed','{}',true);
SELECT set_config('realtime.topic','cart:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE commerce_cart_receiver;
DO $$ BEGIN
 IF (SELECT count(*) FROM realtime.messages) <> 1 THEN RAISE EXCEPTION 'receiver topic projection failed'; END IF;
 BEGIN INSERT INTO realtime.messages(topic) VALUES ('forged'); RAISE EXCEPTION 'client published'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM * FROM public.commerce_cart_lines; RAISE EXCEPTION 'receiver read cart lines'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM * FROM public.customers; RAISE EXCEPTION 'receiver read customers'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.commerce_cart_grants SET revoked_at=now() WHERE id='66666666-6666-4666-8666-666666666666';
DO $$ BEGIN IF public.commerce_cart_receive_authorized(realtime.topic()) THEN RAISE EXCEPTION 'revoked grant joined'; END IF; END $$;
UPDATE public.commerce_cart_grants SET revoked_at=NULL WHERE id='66666666-6666-4666-8666-666666666666';
SELECT set_config('request.jwt.claims',jsonb_set(auth.jwt(),'{exp}','0')::text,true);
DO $$ BEGIN IF public.commerce_cart_receive_authorized(realtime.topic()) THEN RAISE EXCEPTION 'expired token joined'; END IF; END $$;
-- No private row material enters notification payloads. Lost sends must remain retryable.
INSERT INTO public.commerce_cart_events(merchant_id,cart_id,version,operation_id,payload,expires_at) VALUES ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',2,'op-2','{"secret":"must-not-broadcast"}',now()+interval '1 day');
SET LOCAL ROLE commerce_cart_worker;
SELECT public.commerce_cart_publish_events(10,'local-test-worker');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.commerce_cart_events WHERE delivered_at IS NOT NULL) <> 1 THEN RAISE EXCEPTION 'event not acknowledged'; END IF;
 IF NOT EXISTS(SELECT 1 FROM realtime.messages WHERE event='cart_changed' AND payload=jsonb_build_object('merchantId','11111111-1111-4111-8111-111111111111','cartId','22222222-2222-4222-8222-222222222222','version',2,'operationId','op-2')) THEN RAISE EXCEPTION 'safe event projection missing'; END IF;
END $$;
INSERT INTO public.commerce_cart_events(merchant_id,cart_id,version,operation_id,expires_at) VALUES ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',3,'op-3',now()+interval '1 day');
SELECT set_config('cart.test.drop_send','true',true);
SELECT public.commerce_cart_publish_events(10,'local-test-worker');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.commerce_cart_events WHERE version=3 AND delivered_at IS NOT NULL) THEN RAISE EXCEPTION 'lost send acknowledged'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.commerce_cart_events WHERE version=3 AND attempts=1 AND next_attempt_at>now()) THEN RAISE EXCEPTION 'lost send not backed off'; END IF;
END $$;
-- A connection crash/rollback cannot acknowledge or partially publish a row.
SELECT set_config('cart.test.drop_send','false',true);
INSERT INTO public.commerce_cart_events(merchant_id,cart_id,version,operation_id,expires_at) VALUES ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',4,'op-4',now()+interval '1 day');
SAVEPOINT publisher_crash;
SELECT public.commerce_cart_publish_events(10,'local-test-worker');
ROLLBACK TO publisher_crash;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.commerce_cart_events WHERE version=4 AND delivered_at IS NOT NULL) OR EXISTS(SELECT 1 FROM realtime.messages WHERE payload->>'operationId'='op-4') THEN RAISE EXCEPTION 'publisher crash committed a partial send'; END IF;
END $$;
SELECT public.commerce_cart_publish_events(10,'local-test-worker');
SELECT public.commerce_cart_publish_events(10,'local-test-worker');
DO $$ BEGIN IF (SELECT count(*) FROM realtime.messages WHERE payload->>'operationId'='op-4')<>1 THEN RAISE EXCEPTION 'publisher replay duplicated a delivered message'; END IF; END $$;
-- Exhausted sends park in the dead letter state rather than hammering.
UPDATE public.commerce_cart_events SET next_attempt_at=now(),attempts=9 WHERE version=3;
SELECT set_config('cart.test.drop_send','true',true);
SELECT public.commerce_cart_publish_events(10,'local-test-worker');
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.commerce_cart_events WHERE version=3 AND dead_letter_at IS NOT NULL AND attempts=10 AND delivered_at IS NULL) THEN RAISE EXCEPTION 'publisher did not dead letter exhausted retries'; END IF; END $$;
ROLLBACK;
