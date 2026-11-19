-- Contract test: refreshing an unresolved onboarding intent's fingerprint
-- (20261116152303_piggyvest_primary_onboarding_refresh_unknown.sql).
--
-- The caller runs refresh_unknown_onboarding only after PiggyVest's own
-- listing proved no customer exists for this account's identifier. Proves:
--   * plain claim_onboarding still refuses a foreign fingerprint on an
--     unknown intent (no adoption under different details);
--   * a same-user unknown intent without provider ids is re-fingerprinted
--     and re-claimed fresh (reclaimed:false) under a new claim token;
--   * a dispatched intent past its 5-minute lease is refreshable, a fresh
--     dispatch is not;
--   * accepted, verified, routing_pending, rejected and review-held intents,
--     or an intent bound to another user, are never refreshed;
--   * grants match claim_onboarding (catalog only: a denied EXECUTE cannot be
--     trapped on the replay image).
-- The calls run as the session role, registered as the integration executor.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_primary_onboarding_refresh_unknown.sql

BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

CREATE FUNCTION pg_temp.scope(p_n int) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'merchantId', 'a3900000-0000-4000-8000-000000000002',
    'customerId', 'a3900000-0000-4000-8000-00000000001' || p_n,
    'userId', 'a3900000-0000-4000-8000-00000000002' || p_n,
    'integrationId', 'a3900000-0000-4000-8000-000000000005',
    'businessId', 'refresh-unknown-business',
    'environment', 'staging')
$$;

CREATE FUNCTION pg_temp.intent(p_n int) RETURNS piggyvest_primary.onboarding_intents
LANGUAGE sql AS $$
  SELECT * FROM piggyvest_primary.onboarding_intents
  WHERE integration_id = 'a3900000-0000-4000-8000-000000000005'
    AND customer_id = ('a3900000-0000-4000-8000-00000000001' || p_n)::uuid
$$;

-- Claim customer n under fingerprint 'a', then record the given outcome.
CREATE FUNCTION pg_temp.seed(p_n int, p_outcome text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE c jsonb;
BEGIN
  c := piggyvest_primary.claim_onboarding(pg_temp.scope(p_n), repeat('a', 64));
  PERFORM pg_temp.check(c->>'status' = 'claimed', 'seed claim failed for ' || p_n);
  IF p_outcome = 'unknown' THEN
    PERFORM pg_temp.check(piggyvest_primary.record_onboarding(pg_temp.scope(p_n),
      (c->>'intentId')::uuid, (c->>'claimToken')::uuid, NULL, NULL), 'seed unknown failed');
  ELSIF p_outcome = 'accepted' THEN
    PERFORM pg_temp.check(piggyvest_primary.record_onboarding(pg_temp.scope(p_n),
      (c->>'intentId')::uuid, (c->>'claimToken')::uuid, 'refresh-customer-' || p_n,
      'refresh-wallet-' || p_n), 'seed accepted failed');
  ELSIF p_outcome = 'rejected' THEN
    PERFORM piggyvest_primary.record_onboarding_rejection(pg_temp.scope(p_n),
      (c->>'intentId')::uuid, (c->>'claimToken')::uuid);
  ELSIF p_outcome = 'ownership_hold' THEN
    PERFORM pg_temp.check(piggyvest_primary.record_onboarding_ownership_hold(pg_temp.scope(p_n),
      (c->>'intentId')::uuid, (c->>'claimToken')::uuid), 'seed ownership hold failed');
  ELSIF p_outcome = 'routing_pending' THEN
    PERFORM pg_temp.check(piggyvest_primary.record_onboarding_routing_pending(pg_temp.scope(p_n),
      (c->>'intentId')::uuid, (c->>'claimToken')::uuid, 'refresh-customer-' || p_n,
      'refresh-wallet-' || p_n, '01JBZ8Q5W3X9R2K4M6N8P0T2V4'), 'seed routing pending failed');
  END IF;
  RETURN c;
END $$;

-- The refresh must refuse, and leave customer n's intent byte-for-byte as it was.
CREATE FUNCTION pg_temp.refused(p_n int, p_scope jsonb, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE before_row piggyvest_primary.onboarding_intents; result jsonb;
BEGIN
  before_row := pg_temp.intent(p_n);
  result := piggyvest_primary.refresh_unknown_onboarding(p_scope, repeat('b', 64));
  PERFORM pg_temp.check(result = '{"status":"conflict"}'::jsonb, p_label || ' was refreshed');
  PERFORM pg_temp.check(pg_temp.intent(p_n) IS NOT DISTINCT FROM before_row,
    p_label || ' changed on refusal');
END $$;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users(id) VALUES
  ('a3900000-0000-4000-8000-000000000021'), ('a3900000-0000-4000-8000-000000000022'),
  ('a3900000-0000-4000-8000-000000000023'), ('a3900000-0000-4000-8000-000000000024'),
  ('a3900000-0000-4000-8000-000000000025'), ('a3900000-0000-4000-8000-000000000026'),
  ('a3900000-0000-4000-8000-000000000027'), ('a3900000-0000-4000-8000-000000000028'),
  ('a3900000-0000-4000-8000-000000000029'), ('a3900000-0000-4000-8000-000000000030');
INSERT INTO public.merchants(id, email)
  VALUES ('a3900000-0000-4000-8000-000000000002', 'refresh-unknown@example.test');
INSERT INTO public.customers(id, merchant_id, user_id, email)
SELECT ('a3900000-0000-4000-8000-00000000001' || n)::uuid, 'a3900000-0000-4000-8000-000000000002',
  ('a3900000-0000-4000-8000-00000000002' || n)::uuid, 'refresh-' || n || '@example.test'
FROM pg_catalog.generate_series(1, 9) n;
UPDATE piggyvest_primary.integrations SET executor_login = 'retired-' || id::text
  WHERE executor_login = session_user;
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES ('a3900000-0000-4000-8000-000000000005', 'a3900000-0000-4000-8000-000000000002',
    'refresh-unknown-business', 'staging', session_user, true);

-- 1: an unknown intent left by a failed dispatch, retried with new details.
DO $$
DECLARE seeded jsonb; refreshed jsonb; r piggyvest_primary.onboarding_intents;
BEGIN
  seeded := pg_temp.seed(1, 'unknown');
  PERFORM pg_temp.check(piggyvest_primary.claim_onboarding(pg_temp.scope(1), repeat('b', 64))
    = '{"status":"conflict"}'::jsonb, 'unknown intent adopted by foreign request');
  PERFORM pg_temp.check((pg_temp.intent(1)).request_fingerprint = repeat('a', 64),
    'plain claim changed the stored fingerprint');
  refreshed := piggyvest_primary.refresh_unknown_onboarding(pg_temp.scope(1), repeat('b', 64));
  r := pg_temp.intent(1);
  PERFORM pg_temp.check(refreshed->>'status' = 'claimed', 'proven-absent unknown intent not refreshed');
  PERFORM pg_temp.check(refreshed->>'reclaimed' = 'false', 'refresh must be a fresh claim');
  PERFORM pg_temp.check((refreshed->>'intentId')::uuid = r.id
      AND (refreshed->>'intentId')::uuid = (seeded->>'intentId')::uuid, 'refresh replaced the intent');
  PERFORM pg_temp.check(r.state = 'dispatched' AND r.request_fingerprint = repeat('b', 64)
      AND r.claim_token = (refreshed->>'claimToken')::uuid
      AND r.claim_token IS DISTINCT FROM (seeded->>'claimToken')::uuid
      AND r.provider_customer_id IS NULL AND r.provider_wallet_id IS NULL,
    'refreshed intent not re-dispatched under the new fingerprint');
  -- The refreshed claim is a normal claim: it records and the old one is dead.
  PERFORM pg_temp.check(NOT piggyvest_primary.record_onboarding(pg_temp.scope(1), r.id,
    (seeded->>'claimToken')::uuid, NULL, NULL), 'old claim token still recorded');
  PERFORM pg_temp.check(piggyvest_primary.claim_onboarding(pg_temp.scope(1), repeat('b', 64))
    = '{"status":"pending"}'::jsonb, 'refreshed dispatch not leased');
  PERFORM pg_temp.check(piggyvest_primary.claim_onboarding(pg_temp.scope(1), repeat('a', 64))
    = '{"status":"conflict"}'::jsonb, 'old fingerprint still matches after refresh');
  -- A fresh (in-lease) dispatch is never taken over, even by the same user.
  PERFORM pg_temp.refused(1, pg_temp.scope(1), 'fresh dispatched intent');
END $$;

-- 2: a dispatch whose holder died is refreshable once its lease expired.
DO $$
DECLARE seeded jsonb; refreshed jsonb;
BEGIN
  seeded := pg_temp.seed(2, 'dispatched');
  PERFORM pg_temp.refused(2, pg_temp.scope(2), 'in-lease dispatched intent');
  UPDATE piggyvest_primary.onboarding_intents
    SET updated_at = pg_catalog.clock_timestamp() - interval '6 minutes'
    WHERE id = (seeded->>'intentId')::uuid;
  refreshed := piggyvest_primary.refresh_unknown_onboarding(pg_temp.scope(2), repeat('b', 64));
  PERFORM pg_temp.check(refreshed->>'status' = 'claimed' AND refreshed->>'reclaimed' = 'false'
      AND (pg_temp.intent(2)).request_fingerprint = repeat('b', 64)
      AND (pg_temp.intent(2)).claim_token = (refreshed->>'claimToken')::uuid,
    'stale dispatched intent not refreshed');
END $$;

-- 3-7: any intent with provider ids, a terminal verdict or review evidence.
DO $$
BEGIN
  PERFORM pg_temp.seed(3, 'accepted');
  PERFORM pg_temp.refused(3, pg_temp.scope(3), 'accepted intent with provider ids');
  PERFORM pg_temp.seed(4, 'routing_pending');
  PERFORM pg_temp.refused(4, pg_temp.scope(4), 'routing-pending intent with provider ids');
  PERFORM pg_temp.seed(5, 'rejected');
  PERFORM pg_temp.refused(5, pg_temp.scope(5), 'rejected intent');
  PERFORM pg_temp.seed(6, 'ownership_hold');
  PERFORM pg_temp.check((pg_temp.intent(6)).review_reason = 'ownership', 'ownership hold setup');
  PERFORM pg_temp.refused(6, pg_temp.scope(6), 'intent with review evidence');
  PERFORM pg_temp.seed(7, 'accepted');
  UPDATE piggyvest_primary.onboarding_intents SET state = 'verified'
    WHERE id = (pg_temp.intent(7)).id;
  PERFORM pg_temp.refused(7, pg_temp.scope(7), 'verified intent');
END $$;

-- 8: an intent bound to another user is never refreshed, even when the
-- customer row now belongs to the caller.
DO $$
BEGIN
  PERFORM pg_temp.seed(8, 'unknown');
  UPDATE public.customers SET user_id = 'a3900000-0000-4000-8000-000000000030'
    WHERE id = 'a3900000-0000-4000-8000-000000000018';
  PERFORM pg_temp.refused(8, jsonb_set(pg_temp.scope(8), '{userId}',
    '"a3900000-0000-4000-8000-000000000030"'), 'intent of a different user');
END $$;

-- 9: scope and fingerprint are validated before anything is read.
DO $$
BEGIN
  PERFORM pg_temp.seed(9, 'unknown');
  BEGIN
    PERFORM piggyvest_primary.refresh_unknown_onboarding(jsonb_set(pg_temp.scope(9), '{userId}',
      '"a3900000-0000-4000-8000-000000000021"'), repeat('b', 64));
    RAISE EXCEPTION 'foreign scope accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM piggyvest_primary.refresh_unknown_onboarding(pg_temp.scope(9), 'not-a-fingerprint');
    RAISE EXCEPTION 'invalid fingerprint accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  PERFORM pg_temp.check((pg_temp.intent(9)).request_fingerprint = repeat('a', 64),
    'a refused scope or fingerprint changed the intent');
END $$;

-- No intent yet: nothing to refresh (a first claim goes through claim_onboarding).
DO $$
BEGIN
  DELETE FROM piggyvest_primary.onboarding_intents WHERE id = (pg_temp.intent(5)).id;
  PERFORM pg_temp.check(piggyvest_primary.refresh_unknown_onboarding(pg_temp.scope(5), repeat('b', 64))
    = '{"status":"conflict"}'::jsonb, 'missing intent refreshed');
  PERFORM pg_temp.check(pg_temp.intent(5) IS NULL, 'refresh inserted an intent');
END $$;

-- Grants: the onboarding executor group only, like claim_onboarding.
DO $$
DECLARE principal text;
BEGIN
  PERFORM pg_temp.check((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=pg_catalog']
      FROM pg_catalog.pg_proc p
      WHERE p.oid = 'piggyvest_primary.refresh_unknown_onboarding(jsonb,text)'::regprocedure),
    'refresh must be SECURITY DEFINER with a pinned search_path');
  PERFORM pg_temp.check(pg_catalog.has_function_privilege('piggyvest_primary_provisioner',
    'piggyvest_primary.refresh_unknown_onboarding(jsonb,text)', 'EXECUTE'),
    'onboarding executor cannot refresh');
  FOREACH principal IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    PERFORM pg_temp.check(NOT pg_catalog.has_function_privilege(principal,
      'piggyvest_primary.refresh_unknown_onboarding(jsonb,text)', 'EXECUTE'),
      principal || ' can refresh an onboarding intent');
  END LOOP;
  PERFORM pg_temp.check(NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) acl
      WHERE p.oid = 'piggyvest_primary.refresh_unknown_onboarding(jsonb,text)'::regprocedure
        AND acl.grantee = 0),
    'PUBLIC can refresh an onboarding intent');
END $$;

-- 10: identity-change fence persists across subsequent retries without masking ambiguous-dispatch tracking.
DO $$
DECLARE refreshed jsonb; retried jsonb; plain jsonb;
  second_row piggyvest_primary.onboarding_intents;
BEGIN
  -- An ordinary reclaim of a never-refreshed intent omits identityRefreshed,
  -- so the previous app release (strict parser) keeps working mid-rollout.
  plain := piggyvest_primary.claim_onboarding(pg_temp.scope(9), repeat('a', 64));
  PERFORM pg_temp.check(plain->>'status' = 'claimed'
      AND plain->>'reclaimed' = 'true'
      AND NOT (plain ? 'identityRefreshed'),
    'ordinary reclaim must not send identityRefreshed');
  PERFORM pg_temp.check(piggyvest_primary.record_onboarding(pg_temp.scope(9),
    (plain->>'intentId')::uuid, (plain->>'claimToken')::uuid, NULL, NULL),
    'slot 9 ordinary reclaim back to unknown failed');
  -- Customer 9 is 'unknown' under repeat('a', 64); refresh to repeat('b', 64), fail back to 'unknown', then retry 'b'.
  refreshed := piggyvest_primary.refresh_unknown_onboarding(pg_temp.scope(9), repeat('b', 64));
  PERFORM pg_temp.check(refreshed->>'status' = 'claimed'
      AND refreshed->>'reclaimed' = 'false'
      AND refreshed->>'identityRefreshed' = 'true',
    'slot 9 initial refresh failed');
  PERFORM pg_temp.check(piggyvest_primary.record_onboarding(pg_temp.scope(9),
    (refreshed->>'intentId')::uuid, (refreshed->>'claimToken')::uuid, NULL, NULL),
    'slot 9 transition back to unknown failed');
  -- Same-fingerprint stale refresh must conflict even though state returned to unknown.
  PERFORM pg_temp.refused(9, pg_temp.scope(9), 'stale same-fingerprint refresh after transition');
  -- Normal retry keeps reclaimed=true (so custody is never released) while preserving identityRefreshed=true (so old customers are never adopted).
  retried := piggyvest_primary.claim_onboarding(pg_temp.scope(9), repeat('b', 64));
  PERFORM pg_temp.check(retried->>'status' = 'claimed'
      AND retried->>'reclaimed' = 'true'
      AND retried->>'identityRefreshed' = 'true',
    'post-refresh retry lost ambiguous-dispatch tracking or identity-change fence');
  -- A second identity refresh is refused even once the intent is unknown again
  -- under different details: only one BVN change, then manual review.
  PERFORM pg_temp.check(piggyvest_primary.record_onboarding(pg_temp.scope(9),
    (retried->>'intentId')::uuid, (retried->>'claimToken')::uuid, NULL, NULL),
    'slot 9 second transition back to unknown failed');
  second_row := pg_temp.intent(9);
  PERFORM pg_temp.check(piggyvest_primary.refresh_unknown_onboarding(pg_temp.scope(9), repeat('c', 64))
      = '{"status":"conflict"}'::jsonb,
    'a second identity refresh was allowed');
  PERFORM pg_temp.check(pg_temp.intent(9) IS NOT DISTINCT FROM second_row,
    'a refused second refresh changed the intent');
END $$;

ROLLBACK;
