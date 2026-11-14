-- REGRESSION TEST: a shared-cart receiver can join its private channel.
-- Run only in an empty disposable PostgreSQL database, using psql from this
-- directory (never against production):
--   psql -X -v ON_ERROR_STOP=1 -d cart_test \
--     -f supabase/tests/commerce_cart_receive_join_probe.sql
--
-- Realtime authorizes a private-channel join with a probe row that sets only
-- topic and extension, so `private` is its default of false. The stand-ins
-- below mirror production: realtime.messages defaults `private` to false, and
-- realtime.authorize is the function Realtime calls on every join. The first
-- assertion proves the pre-fix policies refused every join; the rest prove
-- the fixed policies admit exactly the receiver's own live cart topic.

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

-- Fixtures: merchant A (live updates on) with carts A1/A2, merchant B (on)
-- with cart B1, merchant C (shared cart only) with cart C1.
CREATE TABLE public.merchants (id uuid PRIMARY KEY, premium_features jsonb);
INSERT INTO public.merchants VALUES
  ('11111111-1111-4111-8111-111111111111', '["shared_cart","shared_cart_realtime"]'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '["shared_cart","shared_cart_realtime"]'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '["shared_cart"]');
INSERT INTO public.commerce_carts (id, merchant_id, state, expires_at) VALUES
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'active', now() + interval '7 days'),
  ('22222222-2222-4222-8222-222222222223', '11111111-1111-4111-8111-111111111111', 'active', now() + interval '7 days'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active', now() + interval '7 days'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'active', now() + interval '7 days');
INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at) VALUES
  ('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'guest-a1', now() + interval '7 days', NULL),
  ('66666666-6666-4666-8666-666666666668', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'guest-a1-rev', now() + interval '7 days', now()),
  ('99999999-9999-4999-8999-999999999999', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'guest-c1', now() + interval '7 days', NULL);

-- Production-shaped realtime schema: `private` defaults to false.
CREATE SCHEMA realtime;
CREATE TABLE realtime.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  extension text NOT NULL,
  payload jsonb,
  event text,
  private boolean DEFAULT false,
  inserted_at timestamp NOT NULL DEFAULT timezone('utc', clock_timestamp()),
  updated_at timestamp NOT NULL DEFAULT timezone('utc', clock_timestamp())
);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
-- Legacy grants and policies that must never widen the receiver.
GRANT SELECT, INSERT ON realtime.messages TO PUBLIC;
CREATE POLICY existing_public_read ON realtime.messages FOR SELECT TO PUBLIC USING (true);
CREATE POLICY existing_public_send ON realtime.messages FOR INSERT TO PUBLIC WITH CHECK (true);
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('realtime.topic', true), '') $$;
CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void LANGUAGE sql AS $$
  INSERT INTO realtime.messages (topic, extension, event, payload, private) VALUES ($3, 'broadcast', $2, $1, $4)
$$;
-- The join check Realtime runs, as deployed in production.
CREATE FUNCTION realtime.authorize(
  role_name text, topic_name text, claims text, sub text, headers text,
  read_extensions text[], write_extensions text[],
  OUT read_allowed boolean[], OUT write_allowed boolean[]
) RETURNS record LANGUAGE plpgsql AS $function$
declare
  probe_ids uuid[];
  probe_inserted_at timestamp := now() at time zone 'utc';
  visible_ids uuid[];
  ext text;
  allowed boolean;
begin
  begin
    probe_ids := array(select gen_random_uuid() from unnest(read_extensions));
    insert into realtime.messages (id, topic, extension, inserted_at, updated_at)
    select p.id, topic_name, p.extension, probe_inserted_at, probe_inserted_at
    from unnest(probe_ids, read_extensions) as p(id, extension);
    perform set_config('role', role_name, true),
            set_config('realtime.topic', topic_name, true),
            set_config('request.jwt.claims', claims, true),
            set_config('request.jwt.claim.sub', sub, true),
            set_config('request.jwt.claim.role', role_name, true),
            set_config('request.headers', headers, true);
    visible_ids := array(
      select m.id from realtime.messages m
      where m.inserted_at = probe_inserted_at and m.id = any(probe_ids));
    read_allowed := array(
      select p.id = any(visible_ids)
      from unnest(probe_ids) with ordinality as p(id, n) order by p.n);
    write_allowed := '{}';
    foreach ext in array write_extensions loop
      begin
        insert into realtime.messages (topic, extension, inserted_at, updated_at)
        values (topic_name, ext, now() at time zone 'utc', now() at time zone 'utc');
        allowed := true;
      exception when insufficient_privilege then
        allowed := false;
      end;
      write_allowed := write_allowed || allowed;
    end loop;
    raise sqlstate 'RTA01';
  exception when sqlstate 'RTA01' then
    null;
  end;
end;
$function$;

\ir ../migrations/20261014070000_commerce_cart_broadcast.sql
\ir ../migrations/20261015165000_commerce_cart_receive_receiver_only.sql
\ir ../migrations/20261015166000_commerce_cart_receiver_predicate_split.sql

-- Test helpers: claims for a five-minute receive token, and the join check.
CREATE FUNCTION pg_temp.claims(p_role text, p_merchant text, p_cart text, p_grant text, p_principal text, p_exp timestamptz DEFAULT now() + interval '5 minutes')
RETURNS text LANGUAGE sql AS $$
  SELECT jsonb_build_object('role', p_role, 'cart_scope', 'session', 'cart_id', p_cart,
    'cart_merchant_id', p_merchant, 'cart_grant_id', p_grant, 'cart_principal_id', p_principal,
    'exp', extract(epoch FROM p_exp))::text
$$;
CREATE FUNCTION pg_temp.can_join(p_role text, p_topic text, p_claims text) RETURNS boolean LANGUAGE sql AS $$
  SELECT read_allowed[1] FROM realtime.authorize(p_role, p_topic, p_claims, '', '{}', ARRAY['broadcast'], ARRAY[]::text[])
$$;
CREATE FUNCTION pg_temp.can_send(p_role text, p_topic text, p_claims text) RETURNS boolean LANGUAGE sql AS $$
  SELECT write_allowed[1] FROM realtime.authorize(p_role, p_topic, p_claims, '', '{}', ARRAY[]::text[], ARRAY['broadcast'])
$$;

-- The exact failing condition: before the fix, a live receiver with a valid
-- token for its own cart was refused, because the probe row is not private.
DO $$ BEGIN
 IF pg_temp.can_join('commerce_cart_receiver',
   'cart:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222',
   pg_temp.claims('commerce_cart_receiver','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','66666666-6666-4666-8666-666666666666','guest-a1'))
 THEN RAISE EXCEPTION 'pre-fix policies unexpectedly admitted the join probe: this test no longer reproduces the defect'; END IF;
END $$;

\ir ../migrations/20261111100000_commerce_cart_receive_join_probe.sql

DO $$
DECLARE
 own_topic constant text := 'cart:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222';
 own_claims constant text := pg_temp.claims('commerce_cart_receiver','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','66666666-6666-4666-8666-666666666666','guest-a1');
BEGIN
 IF NOT pg_temp.can_join('commerce_cart_receiver', own_topic, own_claims) THEN
  RAISE EXCEPTION 'live receiver was refused its own cart channel'; END IF;
 IF pg_temp.can_send('commerce_cart_receiver', own_topic, own_claims) THEN
  RAISE EXCEPTION 'receiver may send on its cart channel'; END IF;
 -- Another cart of the same merchant, another merchant, and a non-cart topic.
 IF pg_temp.can_join('commerce_cart_receiver', 'cart:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222223', own_claims) THEN
  RAISE EXCEPTION 'receiver joined a sibling cart channel'; END IF;
 IF pg_temp.can_join('commerce_cart_receiver', 'cart:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', own_claims) THEN
  RAISE EXCEPTION 'receiver joined a foreign merchant cart channel'; END IF;
 IF pg_temp.can_join('commerce_cart_receiver', 'order-tracking:22222222-2222-4222-8222-222222222222', own_claims) THEN
  RAISE EXCEPTION 'receiver joined a non-cart channel'; END IF;
 -- Forged claims pointing at a cart the grant does not cover.
 IF pg_temp.can_join('commerce_cart_receiver', 'cart:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222223',
   pg_temp.claims('commerce_cart_receiver','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222223','66666666-6666-4666-8666-666666666666','guest-a1')) THEN
  RAISE EXCEPTION 'forged cart claim joined'; END IF;
 -- Revoked grant, expired token, and the broader shopper role.
 IF pg_temp.can_join('commerce_cart_receiver', own_topic,
   pg_temp.claims('commerce_cart_receiver','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','66666666-6666-4666-8666-666666666668','guest-a1-rev')) THEN
  RAISE EXCEPTION 'revoked grant joined'; END IF;
 IF pg_temp.can_join('commerce_cart_receiver', own_topic,
   pg_temp.claims('commerce_cart_receiver','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','66666666-6666-4666-8666-666666666666','guest-a1', now() - interval '1 second')) THEN
  RAISE EXCEPTION 'expired token joined'; END IF;
 -- The shopper role has no access to the realtime schema at all, so its
 -- probe is refused with a privilege error rather than an empty result.
 BEGIN
  IF pg_temp.can_join('commerce_cart_shopper', own_topic,
    pg_temp.claims('commerce_cart_shopper','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','66666666-6666-4666-8666-666666666666','guest-a1')) THEN
   RAISE EXCEPTION 'shopper role joined a cart channel'; END IF;
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 -- A merchant without live updates enrolled.
 IF pg_temp.can_join('commerce_cart_receiver', 'cart:cccccccc-cccc-4ccc-8ccc-cccccccccccc:dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   pg_temp.claims('commerce_cart_receiver','cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd','99999999-9999-4999-8999-999999999999','guest-c1')) THEN
  RAISE EXCEPTION 'unenrolled merchant joined'; END IF;
END $$;

-- Direct reads stay scoped to the receiver's own topic, whatever the row's
-- `private` value, and never reach another cart's notices.
SELECT realtime.send('{"v":1}', 'cart_changed', 'cart:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222', true);
SELECT realtime.send('{"v":1}', 'cart_changed', 'cart:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222223', true);
SELECT realtime.send('{"v":1}', 'cart_changed', 'cart:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
SELECT set_config('request.jwt.claims', pg_temp.claims('commerce_cart_receiver','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','66666666-6666-4666-8666-666666666666','guest-a1'), true);
SELECT set_config('realtime.topic', 'cart:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222', true);
SET LOCAL ROLE commerce_cart_receiver;
DO $$ BEGIN
 IF (SELECT count(*) FROM realtime.messages) <> 1 THEN RAISE EXCEPTION 'receiver read outside its own topic'; END IF;
 BEGIN INSERT INTO realtime.messages (topic, extension) VALUES ('cart:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222', 'broadcast'); RAISE EXCEPTION 'receiver published';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- With no topic set (a direct query outside a channel join) nothing is visible.
SELECT set_config('realtime.topic', '', true);
SET LOCAL ROLE commerce_cart_receiver;
DO $$ BEGIN
 IF (SELECT count(*) FROM realtime.messages) <> 0 THEN RAISE EXCEPTION 'receiver read without a channel topic'; END IF;
END $$;
RESET ROLE;

ROLLBACK;
