-- Contract test: onboarding intents whose interest routing is not proven yet
-- (20261031230000_piggyvest_primary_onboarding_routing_pending.sql).
--
-- Proves, against live PostgreSQL:
--   * a dispatched intent can keep its provider ids as 'routing_pending', and
--     that state is never exposed as a usable wallet (read_onboarding NULL);
--   * claim_onboarding reports it pending and never re-dispatches creation;
--   * only the scoped owner's exact kept ids resolve it: proven routing makes
--     it 'accepted' (usable), a contradiction makes it 'rejected' (terminal,
--     ids kept for review and DVA closure);
--   * wallet-bearing protections follow the provider wallet, not the state:
--     deleting a customer whose routing-pending or routing-rejected intent
--     holds an open DVA is refused until its closure is attested, and a
--     closed DVA is never promoted to a usable wallet by a routing recheck;
--   * a rejected intent that keeps its ids is never usable or verifiable,
--     and no spend, credit or usable predicate names routing_pending;
--   * stale claim tokens and mismatched ids change nothing;
--   * grants and shape, asserted through the catalog (a denied EXECUTE cannot
--     be trapped on the replay image, so no denial is probed by calling).
-- The calls run as the session role, registered as the integration executor.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_primary_onboarding_routing_pending.sql

BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

-- Customer n (1 or 2) of the fixture merchant.
CREATE FUNCTION pg_temp.scope(p_n int) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'merchantId', 'a3300000-0000-4000-8000-000000000002',
    'customerId', 'a3300000-0000-4000-8000-00000000001' || p_n,
    'userId', 'a3300000-0000-4000-8000-00000000002' || p_n,
    'integrationId', 'a3300000-0000-4000-8000-000000000005',
    'businessId', 'routing-pending-business',
    'environment', 'staging')
$$;

CREATE FUNCTION pg_temp.state(p_n int) RETURNS text LANGUAGE sql AS $$
  SELECT state || ':' || coalesce(provider_customer_id, '-') || ':' || coalesce(provider_wallet_id, '-')
  FROM piggyvest_primary.onboarding_intents
  WHERE integration_id = 'a3300000-0000-4000-8000-000000000005'
    AND customer_id = ('a3300000-0000-4000-8000-00000000001' || p_n)::uuid
$$;

CREATE FUNCTION pg_temp.ids(p_customer text, p_wallet text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('providerCustomerId', p_customer, 'providerWalletId', p_wallet)
$$;

-- The proof verify_onboarding takes for a usable wallet with a funding account.
CREATE FUNCTION pg_temp.verify_proof(p_customer text, p_wallet text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_temp.ids(p_customer, p_wallet) || jsonb_build_object('businessId', 'routing-pending-business',
    'currency', 'NGN', 'status', 'active', 'hasFundingAccount', true)
$$;

-- Fixture: one merchant, two customers, one enabled integration. The
-- merchant insert guards need a service_role claim, as in the other suites.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users(id) VALUES
  ('a3300000-0000-4000-8000-000000000021'), ('a3300000-0000-4000-8000-000000000022'),
  ('a3300000-0000-4000-8000-000000000023');
INSERT INTO public.merchants(id, email)
  VALUES ('a3300000-0000-4000-8000-000000000002', 'routing-pending@example.com');
INSERT INTO public.customers(id, merchant_id, user_id) VALUES
  ('a3300000-0000-4000-8000-000000000011', 'a3300000-0000-4000-8000-000000000002',
   'a3300000-0000-4000-8000-000000000021'),
  ('a3300000-0000-4000-8000-000000000012', 'a3300000-0000-4000-8000-000000000002',
   'a3300000-0000-4000-8000-000000000022'),
  ('a3300000-0000-4000-8000-000000000013', 'a3300000-0000-4000-8000-000000000002',
   'a3300000-0000-4000-8000-000000000023');
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES ('a3300000-0000-4000-8000-000000000005', 'a3300000-0000-4000-8000-000000000002',
    'routing-pending-business', 'staging', session_user, true);
CREATE TEMP TABLE claims(n int PRIMARY KEY, intent uuid, token uuid);

-- Deleting customer n, always rolled back: 'dva' when the open-DVA guard
-- refuses it, 'deleted' when it would succeed, 'other' for anything else.
CREATE FUNCTION pg_temp.delete_probe(p_n int) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.customers WHERE id = ('a3300000-0000-4000-8000-00000000001' || p_n)::uuid;
  RAISE EXCEPTION 'delete probe rolled back';
EXCEPTION WHEN OTHERS THEN
  RETURN CASE SQLERRM WHEN 'delete probe rolled back' THEN 'deleted'
    WHEN 'cannot delete customer with open provider DVA' THEN 'dva' ELSE 'other' END;
END $$;

-- 1. A routing-pending wallet keeps its ids, is not usable, and a repeated
--    setup request never re-dispatches creation.
DO $$
DECLARE v_claim jsonb;
BEGIN
  v_claim := piggyvest_primary.claim_onboarding(pg_temp.scope(1), repeat('c', 64));
  PERFORM pg_temp.check(v_claim->>'status' = 'claimed', 'fresh onboarding not claimed');
  INSERT INTO claims VALUES (1, (v_claim->>'intentId')::uuid, (v_claim->>'claimToken')::uuid);
  PERFORM pg_temp.check(piggyvest_primary.record_onboarding_routing_pending(pg_temp.scope(1),
    (v_claim->>'intentId')::uuid, (v_claim->>'claimToken')::uuid, 'pv-customer-1', 'pv-wallet-1', '01JBZ8Q5W3X9R2K4M6N8P0T2V4'),
    'routing-pending ids not recorded');
  PERFORM pg_temp.check(pg_temp.state(1) = 'routing_pending:pv-customer-1:pv-wallet-1', 'ids not kept: ' || pg_temp.state(1));
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding(pg_temp.scope(1)) IS NULL,
    'a routing-pending wallet must not be exposed as usable');
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding_routing(pg_temp.scope(1)) = pg_temp.ids('pv-customer-1', 'pv-wallet-1')
      || jsonb_build_object('intentId', v_claim->>'intentId', 'payoutWalletId', '01JBZ8Q5W3X9R2K4M6N8P0T2V4'),
    'the kept ids and creation-time payout must be readable for recovery');
  PERFORM pg_temp.check(NOT piggyvest_primary.verify_onboarding(pg_temp.scope(1), pg_temp.verify_proof('pv-customer-1', 'pv-wallet-1')),
    'a routing-pending wallet must never be verified as usable');
  PERFORM pg_temp.check(piggyvest_primary.claim_onboarding(pg_temp.scope(1), repeat('c', 64)) = '{"status":"pending"}'::jsonb,
    'a routing-pending intent must report pending and never be re-claimed');
  PERFORM pg_temp.check(pg_temp.state(1) = 'routing_pending:pv-customer-1:pv-wallet-1', 'a repeated claim changed the intent');
  -- Even past the five-minute dispatch lease it is never re-claimed.
  UPDATE piggyvest_primary.onboarding_intents SET updated_at = pg_catalog.clock_timestamp() - interval '10 minutes'
    WHERE id = (v_claim->>'intentId')::uuid;
  PERFORM pg_temp.check(piggyvest_primary.claim_onboarding(pg_temp.scope(1), repeat('c', 64)) = '{"status":"pending"}'::jsonb,
    'a stale routing-pending intent must still never be re-claimed');
END $$;

-- 2. Stale tokens, another customer's scope and mismatched ids change nothing.
DO $$
DECLARE v_claim claims%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_claim FROM claims WHERE n = 1;
  PERFORM pg_temp.check(NOT piggyvest_primary.record_onboarding_routing_pending(pg_temp.scope(1),
    v_claim.intent, v_claim.token, 'pv-customer-x', 'pv-wallet-x', '01JBZ8Q5W3X9R2K4M6N8P0T2V4'), 'a spent claim token re-recorded ids');
  PERFORM pg_temp.check(NOT piggyvest_primary.resolve_onboarding_routing(pg_temp.scope(1),
    pg_temp.ids('pv-customer-1', 'pv-wallet-other'), true), 'a mismatched wallet id resolved the intent');
  PERFORM pg_temp.check(NOT piggyvest_primary.resolve_onboarding_routing(pg_temp.scope(1),
    pg_temp.ids('pv-customer-other', 'pv-wallet-1'), true), 'a mismatched customer id resolved the intent');
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding_routing(pg_temp.scope(2)) IS NULL,
    'another customer read the kept ids');
  PERFORM pg_temp.check(NOT piggyvest_primary.resolve_onboarding_routing(pg_temp.scope(2),
    pg_temp.ids('pv-customer-1', 'pv-wallet-1'), true), 'another customer resolved the intent');
  PERFORM pg_temp.check(pg_temp.state(1) = 'routing_pending:pv-customer-1:pv-wallet-1', 'a refused call changed the intent');
END $$;

-- 3. Proven routing makes the kept wallet usable, exactly once.
DO $$
BEGIN
  PERFORM pg_temp.check(piggyvest_primary.resolve_onboarding_routing(pg_temp.scope(1),
    pg_temp.ids('pv-customer-1', 'pv-wallet-1'), true), 'proven routing did not resolve');
  PERFORM pg_temp.check(pg_temp.state(1) = 'accepted:pv-customer-1:pv-wallet-1', 'not accepted: ' || pg_temp.state(1));
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding(pg_temp.scope(1)) = pg_temp.ids('pv-customer-1', 'pv-wallet-1'),
    'the accepted wallet must be readable as usable');
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding_routing(pg_temp.scope(1)) IS NULL,
    'an accepted wallet is no longer routing pending');
  PERFORM pg_temp.check(NOT piggyvest_primary.resolve_onboarding_routing(pg_temp.scope(1),
    pg_temp.ids('pv-customer-1', 'pv-wallet-1'), false), 'an accepted wallet was resolved again');
  PERFORM pg_temp.check(piggyvest_primary.verify_onboarding(pg_temp.scope(1), pg_temp.verify_proof('pv-customer-1', 'pv-wallet-1')),
    'the accepted wallet must verify once its funding account is proven');
  PERFORM pg_temp.check(pg_temp.state(1) = 'verified:pv-customer-1:pv-wallet-1', 'not verified: ' || pg_temp.state(1));
END $$;

-- 4. A contradicted routing is terminal review: ids cleared, never re-claimed.
DO $$
DECLARE v_claim jsonb;
BEGIN
  v_claim := piggyvest_primary.claim_onboarding(pg_temp.scope(2), repeat('d', 64));
  -- The claim-token fence: a different token never records over a live dispatch.
  PERFORM pg_temp.check(NOT piggyvest_primary.record_onboarding_routing_pending(pg_temp.scope(2),
    (v_claim->>'intentId')::uuid, 'a3300000-0000-4000-8000-0000000000ff', 'pv-customer-2', 'pv-wallet-2', '01JBZ8Q5W3X9R2K4M6N8P0T2V4'),
    'a foreign claim token recorded ids');
  PERFORM pg_temp.check(pg_temp.state(2) = 'dispatched:-:-', 'a foreign token changed the dispatch: ' || pg_temp.state(2));
  PERFORM pg_temp.check(piggyvest_primary.record_onboarding_routing_pending(pg_temp.scope(2),
    (v_claim->>'intentId')::uuid, (v_claim->>'claimToken')::uuid, 'pv-customer-2', 'pv-wallet-2', '01JBZ8Q5W3X9R2K4M6N8P0T2V4'),
    'second routing-pending ids not recorded');
  PERFORM pg_temp.check(piggyvest_primary.resolve_onboarding_routing(pg_temp.scope(2),
    pg_temp.ids('pv-customer-2', 'pv-wallet-2'), false), 'a contradicted routing did not resolve');
  PERFORM pg_temp.check(pg_temp.state(2) = 'rejected:pv-customer-2:pv-wallet-2', 'not rejected with kept ids: ' || pg_temp.state(2));
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding(pg_temp.scope(2)) IS NULL, 'a rejected wallet must not be usable');
  PERFORM pg_temp.check(NOT piggyvest_primary.verify_onboarding(pg_temp.scope(2), pg_temp.verify_proof('pv-customer-2', 'pv-wallet-2')),
    'a rejected wallet that keeps its ids must never be verified as usable');
  PERFORM pg_temp.check(pg_temp.state(2) = 'rejected:pv-customer-2:pv-wallet-2', 'a refused verification changed the intent');
  PERFORM pg_temp.check(piggyvest_primary.claim_onboarding(pg_temp.scope(2), repeat('d', 64)) = '{"status":"conflict"}'::jsonb,
    'a rejected routing must stay in review');
END $$;

-- 5. The deletion guard and DVA closure follow the provider wallet: a
--    routing-pending or routing-rejected customer cannot be deleted until
--    its DVA closure is attested, and a closed DVA never becomes usable.
DO $$
DECLARE v_claim jsonb;
BEGIN
  v_claim := piggyvest_primary.claim_onboarding(pg_temp.scope(3), repeat('e', 64));
  PERFORM pg_temp.check(piggyvest_primary.record_onboarding_routing_pending(pg_temp.scope(3),
    (v_claim->>'intentId')::uuid, (v_claim->>'claimToken')::uuid, 'pv-customer-3', 'pv-wallet-3', '01JBZ8Q5W3X9R2K4M6N8P0T2V4'),
    'third routing-pending ids not recorded');
  PERFORM pg_temp.check(pg_temp.delete_probe(3) = 'dva', 'a routing-pending DVA did not block deletion');
  PERFORM pg_temp.check(pg_temp.delete_probe(2) = 'dva', 'a routing-rejected DVA did not block deletion');
  PERFORM piggyvest_primary.attest_provider_dva_closure((v_claim->>'intentId')::uuid);
  PERFORM pg_temp.check(
    (SELECT provider_closed_at IS NOT NULL FROM piggyvest_primary.onboarding_intents WHERE id = (v_claim->>'intentId')::uuid),
    'DVA closure must be attestable for a routing-pending wallet');
  -- A recheck proving the routing after offboarding closed the DVA ends the
  -- intent in review, never as a usable wallet.
  PERFORM pg_temp.check(piggyvest_primary.resolve_onboarding_routing(pg_temp.scope(3),
    pg_temp.ids('pv-customer-3', 'pv-wallet-3'), true), 'a closed routing-pending wallet was not resolved');
  PERFORM pg_temp.check(pg_temp.state(3) = 'rejected:pv-customer-3:pv-wallet-3', 'a closed DVA was promoted: ' || pg_temp.state(3));
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding(pg_temp.scope(3)) IS NULL, 'a closed DVA must not be usable');
  PERFORM pg_temp.check(pg_temp.delete_probe(3) <> 'dva', 'an attested closure still blocked deletion');
  PERFORM piggyvest_primary.attest_provider_dva_closure(
    (SELECT id FROM piggyvest_primary.onboarding_intents
     WHERE integration_id = 'a3300000-0000-4000-8000-000000000005'
       AND customer_id = 'a3300000-0000-4000-8000-000000000012'));
  PERFORM pg_temp.check(
    (SELECT provider_closed_at IS NOT NULL FROM piggyvest_primary.onboarding_intents
     WHERE integration_id = 'a3300000-0000-4000-8000-000000000005'
       AND customer_id = 'a3300000-0000-4000-8000-000000000012'),
    'DVA closure must be attestable for a routing-rejected wallet');
  PERFORM pg_temp.check(pg_temp.delete_probe(2) <> 'dva', 'an attested routing-rejected closure still blocked deletion');
END $$;

-- 6. Wallet-bearing protections key on the provider wallet. Tripwire: no
--    spend, credit or usable predicate names routing_pending (each keeps
--    its own accepted/verified allowlist; the behaviour is probed above).
DO $$
DECLARE v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'block_unsettled_bank_inbox_customer_deletion', 'attest_provider_dva_closure', 'guard_intent_provider_closure'
  ] LOOP
    PERFORM pg_temp.check(
      (SELECT bool_and(pg_catalog.pg_get_functiondef(p.oid) LIKE '%provider_wallet_id IS NULL%'
                       OR pg_catalog.pg_get_functiondef(p.oid) LIKE '%provider_wallet_id IS NOT NULL%')
         AND bool_and(pg_catalog.pg_get_functiondef(p.oid) NOT LIKE '%''accepted''%')
       FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'piggyvest_primary'::regnamespace AND p.proname = v_name),
      v_name || ' must follow the provider wallet, not the onboarding state');
  END LOOP;
  FOREACH v_name IN ARRAY ARRAY[
    'read_onboarding', 'verify_onboarding', 'apply_inflow', 'enqueue_bank_inbox', 'process_bank_inbox',
    'assert_savings_scope', 'assert_goal_wallet_scope', 'read_dispatched_savings',
    'find_dispatched_savings_by_reference', 'release_failed_savings', 'settle_savings',
    'eligible_interest_crosswalk'
  ] LOOP
    PERFORM pg_temp.check(
      (SELECT count(*) > 0 AND bool_and(pg_catalog.pg_get_functiondef(p.oid) NOT LIKE '%routing_pending%')
       FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'piggyvest_primary'::regnamespace AND p.proname = v_name),
      v_name || ' must keep routing_pending wallets unusable');
  END LOOP;
  PERFORM pg_temp.check(
    (SELECT count(DISTINCT p.proname) = 5 AND bool_and(pg_catalog.pg_get_functiondef(p.oid) NOT LIKE '%routing_pending%')
     FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'piggyvest_primary_card'::regnamespace
       AND p.proname IN ('dispatch_context', 'reserve', 'select_ready_transfers', 'settle_custody_ledger_impl', 'transfer_context')),
    'card spend predicates must keep routing_pending wallets unusable');
END $$;

-- 7. Shape, constraints and grants, through the catalog only.
DO $$
DECLARE
  v_fn regprocedure;
  v_role text;
BEGIN
  PERFORM pg_temp.check(
    (SELECT count(*) FROM pg_catalog.pg_constraint
     WHERE conrelid = 'piggyvest_primary.onboarding_intents'::regclass AND contype = 'c'
       AND pg_catalog.pg_get_constraintdef(oid) LIKE '%routing_pending%') = 3,
    'routing_pending must be in the state, coherence and stored-payout checks');
  FOREACH v_fn IN ARRAY ARRAY[
    'piggyvest_primary.record_onboarding_routing_pending(jsonb,uuid,uuid,text,text,text)'::regprocedure,
    'piggyvest_primary.read_onboarding_routing(jsonb)'::regprocedure,
    'piggyvest_primary.resolve_onboarding_routing(jsonb,jsonb,boolean)'::regprocedure
  ] LOOP
    FOREACH v_role IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
      PERFORM pg_temp.check(NOT pg_catalog.has_function_privilege(v_role, v_fn, 'EXECUTE'),
        v_role || ' can execute ' || v_fn::text);
    END LOOP;
    PERFORM pg_temp.check(
      pg_catalog.has_function_privilege('piggyvest_primary_provisioner', v_fn, 'EXECUTE'),
      'the onboarding provisioner lacks EXECUTE on ' || v_fn::text);
    PERFORM pg_temp.check(
      (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog']
       FROM pg_catalog.pg_proc p WHERE p.oid = v_fn),
      v_fn::text || ' must be SECURITY DEFINER with a pinned search_path');
  END LOOP;
END $$;

ROLLBACK;
