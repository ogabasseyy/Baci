-- Contract test for piggyvest_primary.has_onboarding(jsonb)
-- (20261102121549_piggyvest_onboarding_presence.sql).
--
-- Proves, against live PostgreSQL:
--   * an owned scope with no intent reads false, and another customer's
--     intent never makes it true;
--   * the same customer's intent under another integration of the same
--     merchant, or under another merchant's integration, never makes the
--     session integration read true;
--   * any durable intent for the customer under the integration (dispatched,
--     unknown, or one written under an earlier user binding) reads true, so
--     "not started" is never reported where a new claim would collide;
--   * a released (deleted) dispatched intent reads false again;
--   * a foreign user, merchant, integration, business or environment, a
--     disabled integration, a mismatched SESSION_USER binding and a malformed
--     scope all raise 42501: a scope the session cannot own never reads false;
--   * the lookup changes no intent row.
-- The calls run as the session role, registered as the integration executor.
-- Transaction-local: every fixture row is rolled back.
BEGIN;

-- piggyvest_primary_onboarding_review_hold.sql runs earlier in the replay and
-- commits an integration bound to this SESSION_USER; executor_login is
-- UNIQUE. Retire that binding inside this transaction only.
UPDATE piggyvest_primary.integrations
  SET executor_login = executor_login || '-retired'
  WHERE executor_login = SESSION_USER;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

-- Customer n (1 to 3) of the fixture merchant.
CREATE FUNCTION pg_temp.scope(p_n int) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'merchantId', 'b2c00000-0000-4000-8000-000000000002',
    'customerId', 'b2c00000-0000-4000-8000-00000000001' || p_n,
    'userId', 'b2c00000-0000-4000-8000-00000000002' || p_n,
    'integrationId', 'b2c00000-0000-4000-8000-000000000005',
    'businessId', 'presence-business',
    'environment', 'staging')
$$;

-- 'true' / 'false', 'denied' for 42501, or the unexpected SQLSTATE.
CREATE FUNCTION pg_temp.presence(p_scope jsonb) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN piggyvest_primary.has_onboarding(p_scope)::text;
EXCEPTION
  WHEN insufficient_privilege THEN RETURN 'denied';
  WHEN OTHERS THEN RETURN 'sqlstate:' || SQLSTATE;
END $$;

-- Fixture: one merchant, three customers, one enabled integration. The
-- merchant insert guards need a service_role claim, as in the other suites.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users(id) VALUES
  ('b2c00000-0000-4000-8000-000000000021'), ('b2c00000-0000-4000-8000-000000000022'),
  ('b2c00000-0000-4000-8000-000000000023');
INSERT INTO public.merchants(id, email)
  VALUES ('b2c00000-0000-4000-8000-000000000002', 'presence@example.test');
INSERT INTO public.customers(id, merchant_id, user_id, email) VALUES
  ('b2c00000-0000-4000-8000-000000000011', 'b2c00000-0000-4000-8000-000000000002',
   'b2c00000-0000-4000-8000-000000000021', 'presence-1@example.test'),
  ('b2c00000-0000-4000-8000-000000000012', 'b2c00000-0000-4000-8000-000000000002',
   'b2c00000-0000-4000-8000-000000000022', 'presence-2@example.test'),
  ('b2c00000-0000-4000-8000-000000000013', 'b2c00000-0000-4000-8000-000000000002',
   'b2c00000-0000-4000-8000-000000000023', 'presence-3@example.test');
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES ('b2c00000-0000-4000-8000-000000000005', 'b2c00000-0000-4000-8000-000000000002',
    'presence-business', 'staging', SESSION_USER, true);
CREATE TEMP TABLE presence_claims(n int PRIMARY KEY, intent uuid, token uuid);

-- Never started, and another customer's intent never counts.
DO $$
DECLARE c jsonb;
BEGIN
  PERFORM pg_temp.check(pg_temp.presence(pg_temp.scope(1)) = 'false',
    'a never-started customer did not read false');
  c := piggyvest_primary.claim_onboarding(pg_temp.scope(2), repeat('2', 64));
  PERFORM pg_temp.check(c->>'status' = 'claimed', 'second customer claim failed');
  INSERT INTO presence_claims VALUES (2, (c->>'intentId')::uuid, (c->>'claimToken')::uuid);
  PERFORM pg_temp.check(pg_temp.presence(pg_temp.scope(2)) = 'true',
    'a dispatched intent did not read true');
  PERFORM pg_temp.check(pg_temp.presence(pg_temp.scope(1)) = 'false',
    'another customer''s intent made this customer read true');
END $$;

-- The same customer's intent under any other integration never counts: a
-- second integration of the same merchant (its own executor login) and a
-- foreign merchant's integration each hold an intent for customer 1, and
-- the session integration still reads false.
INSERT INTO public.merchants(id, email)
  VALUES ('b2c00000-0000-4000-8000-000000000003', 'presence-foreign@example.test');
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES
    ('b2c00000-0000-4000-8000-000000000006', 'b2c00000-0000-4000-8000-000000000002',
     'presence-pilot-business', 'staging', SESSION_USER || '-pilot', true),
    ('b2c00000-0000-4000-8000-000000000007', 'b2c00000-0000-4000-8000-000000000003',
     'presence-foreign-business', 'staging', SESSION_USER || '-foreign', true);
INSERT INTO piggyvest_primary.onboarding_intents(integration_id, merchant_id, customer_id,
    user_id, request_fingerprint, state)
  VALUES
    ('b2c00000-0000-4000-8000-000000000006', 'b2c00000-0000-4000-8000-000000000002',
     'b2c00000-0000-4000-8000-000000000011', 'b2c00000-0000-4000-8000-000000000021',
     repeat('6', 64), 'unknown'),
    ('b2c00000-0000-4000-8000-000000000007', 'b2c00000-0000-4000-8000-000000000003',
     'b2c00000-0000-4000-8000-000000000011', 'b2c00000-0000-4000-8000-000000000021',
     repeat('7', 64), 'unknown');
DO $$
BEGIN
  PERFORM pg_temp.check(pg_temp.presence(pg_temp.scope(1)) = 'false',
    'another integration''s intent made the session integration read true');
END $$;

-- A scope the session cannot own raises 42501 rather than reading false.
DO $$
DECLARE
  own jsonb := pg_temp.scope(1);
  foreign_id text := 'b2c00000-0000-4000-8000-0000000000ff';
BEGIN
  PERFORM pg_temp.check(pg_temp.presence(own || jsonb_build_object(
    'userId', 'b2c00000-0000-4000-8000-000000000022')) = 'denied', 'foreign user accepted');
  PERFORM pg_temp.check(pg_temp.presence(own || jsonb_build_object(
    'merchantId', foreign_id)) = 'denied', 'foreign merchant accepted');
  PERFORM pg_temp.check(pg_temp.presence(own || jsonb_build_object(
    'integrationId', foreign_id)) = 'denied', 'foreign integration accepted');
  PERFORM pg_temp.check(pg_temp.presence(own || jsonb_build_object(
    'businessId', 'other-business')) = 'denied', 'foreign business accepted');
  PERFORM pg_temp.check(pg_temp.presence(own || jsonb_build_object(
    'environment', 'production')) = 'denied', 'foreign environment accepted');
  PERFORM pg_temp.check(pg_temp.presence(own || jsonb_build_object(
    'providerWalletId', 'client-wallet')) = 'denied', 'scope with an extra key accepted');
  PERFORM pg_temp.check(pg_temp.presence(own - 'customerId') = 'denied',
    'scope without a customer accepted');
  PERFORM pg_temp.check(pg_temp.presence(NULL) = 'denied', 'null scope accepted');

  UPDATE piggyvest_primary.integrations SET executor_login = SESSION_USER || '_mismatch'
    WHERE id = 'b2c00000-0000-4000-8000-000000000005';
  PERFORM pg_temp.check(pg_temp.presence(own) = 'denied',
    'mismatched SESSION_USER binding accepted');
  UPDATE piggyvest_primary.integrations SET executor_login = SESSION_USER, enabled = false
    WHERE id = 'b2c00000-0000-4000-8000-000000000005';
  PERFORM pg_temp.check(pg_temp.presence(own) = 'denied', 'disabled integration accepted');
  UPDATE piggyvest_primary.integrations SET enabled = true
    WHERE id = 'b2c00000-0000-4000-8000-000000000005';
  PERFORM pg_temp.check(pg_temp.presence(own) = 'false', 'restored binding did not read false');
END $$;

-- Every durable intent reads true; presence never changes the row.
DO $$
DECLARE c jsonb; before_row jsonb;
BEGIN
  c := piggyvest_primary.claim_onboarding(pg_temp.scope(1), repeat('1', 64));
  PERFORM pg_temp.check(c->>'status' = 'claimed', 'own claim failed');
  SELECT to_jsonb(intent) INTO before_row FROM piggyvest_primary.onboarding_intents intent
    WHERE id = (c->>'intentId')::uuid;
  PERFORM pg_temp.check(pg_temp.presence(pg_temp.scope(1)) = 'true',
    'own dispatched intent did not read true');
  PERFORM pg_temp.check((SELECT to_jsonb(intent) = before_row
      FROM piggyvest_primary.onboarding_intents intent WHERE id = (c->>'intentId')::uuid),
    'the presence lookup changed the intent row');
  PERFORM pg_temp.check(piggyvest_primary.record_onboarding(pg_temp.scope(1),
    (c->>'intentId')::uuid, (c->>'claimToken')::uuid, NULL, NULL), 'unknown result setup failed');
  PERFORM pg_temp.check(pg_temp.presence(pg_temp.scope(1)) = 'true',
    'an unknown provider result read as not started');

  -- An intent kept from an earlier user binding of the same customer still
  -- blocks a new claim, so it must not read as not started either.
  INSERT INTO piggyvest_primary.onboarding_intents(integration_id, merchant_id, customer_id,
      user_id, request_fingerprint, state)
    VALUES ('b2c00000-0000-4000-8000-000000000005', 'b2c00000-0000-4000-8000-000000000002',
      'b2c00000-0000-4000-8000-000000000013', 'b2c00000-0000-4000-8000-000000000029',
      repeat('3', 64), 'unknown');
  PERFORM pg_temp.check(piggyvest_primary.claim_onboarding(pg_temp.scope(3), repeat('3', 64))
    = '{"status":"conflict"}'::jsonb, 'fixture: earlier-binding intent did not conflict');
  PERFORM pg_temp.check(pg_temp.presence(pg_temp.scope(3)) = 'true',
    'an earlier-binding intent read as not started');
END $$;

-- Releasing a definitively rejected dispatch deletes the intent: the
-- customer may start again, and presence says so.
DO $$
DECLARE r presence_claims%ROWTYPE;
BEGIN
  SELECT * INTO STRICT r FROM presence_claims WHERE n = 2;
  PERFORM pg_temp.check(piggyvest_primary.release_onboarding_intent(pg_temp.scope(2), r.intent, r.token),
    'release setup failed');
  PERFORM pg_temp.check(pg_temp.presence(pg_temp.scope(2)) = 'false',
    'a released intent still read as started');
END $$;

ROLLBACK;
