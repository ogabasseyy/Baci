-- Contract tests for durable ownership/routing review evidence and its
-- customer-deletion boundary (20261101171000).
BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

CREATE FUNCTION pg_temp.scope(p_n int) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'merchantId', 'a3600000-0000-4000-8000-000000000002',
    'customerId', 'a3600000-0000-4000-8000-00000000001' || p_n,
    'userId', 'a3600000-0000-4000-8000-00000000002' || p_n,
    'integrationId', 'a3600000-0000-4000-8000-000000000005',
    'businessId', 'review-hold-business',
    'environment', 'staging')
$$;

CREATE FUNCTION pg_temp.verify_proof(p_customer text, p_wallet text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'providerCustomerId', p_customer,
    'providerWalletId', p_wallet,
    'businessId', 'review-hold-business',
    'currency', 'NGN', 'status', 'active', 'hasFundingAccount', true)
$$;

-- A successful DELETE is rolled back so all assertions share one fixture.
CREATE FUNCTION pg_temp.delete_probe(p_n int) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.customers
    WHERE id = ('a3600000-0000-4000-8000-00000000001' || p_n)::uuid;
  RAISE EXCEPTION 'delete probe rollback';
EXCEPTION WHEN OTHERS THEN
  RETURN CASE SQLERRM
    WHEN 'delete probe rollback' THEN 'deleted'
    WHEN 'cannot delete customer with unresolved provider onboarding' THEN 'unresolved'
    WHEN 'cannot delete customer with open provider DVA' THEN 'open_dva'
    ELSE 'other:' || SQLERRM
  END;
END $$;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users(id) VALUES
  ('a3600000-0000-4000-8000-000000000021'), ('a3600000-0000-4000-8000-000000000022'),
  ('a3600000-0000-4000-8000-000000000023'), ('a3600000-0000-4000-8000-000000000024'),
  ('a3600000-0000-4000-8000-000000000025'), ('a3600000-0000-4000-8000-000000000026');
INSERT INTO public.merchants(id, email)
  VALUES ('a3600000-0000-4000-8000-000000000002', 'review-hold@example.test');
INSERT INTO public.customers(id, merchant_id, user_id, email) VALUES
  ('a3600000-0000-4000-8000-000000000011', 'a3600000-0000-4000-8000-000000000002', 'a3600000-0000-4000-8000-000000000021', 'review-1@example.test'),
  ('a3600000-0000-4000-8000-000000000012', 'a3600000-0000-4000-8000-000000000002', 'a3600000-0000-4000-8000-000000000022', 'review-2@example.test'),
  ('a3600000-0000-4000-8000-000000000013', 'a3600000-0000-4000-8000-000000000002', 'a3600000-0000-4000-8000-000000000023', 'review-3@example.test'),
  ('a3600000-0000-4000-8000-000000000014', 'a3600000-0000-4000-8000-000000000002', 'a3600000-0000-4000-8000-000000000024', 'review-4@example.test'),
  ('a3600000-0000-4000-8000-000000000015', 'a3600000-0000-4000-8000-000000000002', 'a3600000-0000-4000-8000-000000000025', 'review-5@example.test'),
  ('a3600000-0000-4000-8000-000000000016', 'a3600000-0000-4000-8000-000000000002', 'a3600000-0000-4000-8000-000000000026', 'review-6@example.test');
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES ('a3600000-0000-4000-8000-000000000005', 'a3600000-0000-4000-8000-000000000002',
    'review-hold-business', 'staging', session_user, true);

CREATE TEMP TABLE review_claims(n int PRIMARY KEY, intent uuid, token uuid);

-- Ownership hold: claim fencing, tenant scope, terminal retry behavior,
-- unreadable/non-spendable wallet, and the walletless deletion hold.
DO $$
DECLARE c jsonb; c2 jsonb;
BEGIN
  c := piggyvest_primary.claim_onboarding(pg_temp.scope(1), repeat('a', 64));
  PERFORM pg_temp.check(c->>'status' = 'claimed', 'ownership hold setup claim failed');
  INSERT INTO review_claims VALUES (1, (c->>'intentId')::uuid, (c->>'claimToken')::uuid);
  PERFORM pg_temp.check(NOT piggyvest_primary.record_onboarding_ownership_hold(
    pg_temp.scope(1), (c->>'intentId')::uuid, 'a3600000-0000-4000-8000-0000000000ff'),
    'wrong token changed a still-dispatched intent');
  PERFORM pg_temp.check(NOT piggyvest_primary.record_onboarding_ownership_hold(
    pg_temp.scope(6), (c->>'intentId')::uuid, (c->>'claimToken')::uuid),
    'wrong scope changed a still-dispatched intent');
  PERFORM pg_temp.check((SELECT state = 'dispatched' AND review_reason IS NULL
      AND claim_token = (c->>'claimToken')::uuid
      AND provider_customer_id IS NULL AND provider_wallet_id IS NULL
    FROM piggyvest_primary.onboarding_intents WHERE id = (c->>'intentId')::uuid),
    'failed token/scope fences mutated the dispatched intent');
  PERFORM pg_temp.check(piggyvest_primary.record_onboarding_ownership_hold(
    pg_temp.scope(1), (c->>'intentId')::uuid, (c->>'claimToken')::uuid), 'ownership hold write failed');
  PERFORM pg_temp.check(NOT piggyvest_primary.record_onboarding_ownership_hold(
    pg_temp.scope(1), (c->>'intentId')::uuid, (c->>'claimToken')::uuid), 'spent hold claim replayed');
  PERFORM pg_temp.check((SELECT state = 'rejected' AND review_reason = 'ownership'
      AND claim_token IS NULL AND provider_customer_id IS NULL AND provider_wallet_id IS NULL
    FROM piggyvest_primary.onboarding_intents WHERE id = (c->>'intentId')::uuid),
    'ownership hold stored provider identity or missed its terminal reason');
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding_review(pg_temp.scope(1)) = 'ownership',
    'ownership review reason not readable');
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding(pg_temp.scope(1)) IS NULL,
    'ownership-held intent became a usable wallet');
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding_routing(pg_temp.scope(1)) IS NULL,
    'ownership-held intent became routing-recheckable');
  PERFORM pg_temp.check(NOT piggyvest_primary.verify_onboarding(
    pg_temp.scope(1), pg_temp.verify_proof('held-customer', 'held-wallet')),
    'ownership-held intent became spendable');
  c2 := piggyvest_primary.claim_onboarding(pg_temp.scope(1), repeat('a', 64));
  PERFORM pg_temp.check(c2 = '{"status":"conflict"}'::jsonb, 'ownership hold was reclaimed');
  PERFORM pg_temp.check(pg_temp.delete_probe(1) = 'unresolved', 'walletless ownership hold allowed deletion');
END $$;

-- A live dispatched request and a recorded unknown result both protect the
-- crash window. An old terminal rejection without a reason reads ownership
-- for review but remains deletable because it never held a provider wallet.
DO $$
DECLARE dispatched jsonb; uncertain jsonb; rejected jsonb;
BEGIN
  dispatched := piggyvest_primary.claim_onboarding(pg_temp.scope(2), repeat('b', 64));
  INSERT INTO review_claims VALUES (2, (dispatched->>'intentId')::uuid, (dispatched->>'claimToken')::uuid);
  BEGIN
    UPDATE piggyvest_primary.onboarding_intents SET review_reason = 'other'
      WHERE id = (dispatched->>'intentId')::uuid;
    RAISE EXCEPTION 'invalid review reason unexpectedly stored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE piggyvest_primary.onboarding_intents SET review_reason = 'ownership'
      WHERE id = (dispatched->>'intentId')::uuid;
    RAISE EXCEPTION 'review reason on a dispatched row unexpectedly stored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM pg_temp.check((SELECT review_reason IS NULL
    FROM piggyvest_primary.onboarding_intents WHERE id = (dispatched->>'intentId')::uuid),
    'invalid review-reason checks changed the dispatched row');
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding_review(pg_temp.scope(2)) IS NULL,
    'non-rejected dispatched intent returned a review reason');
  PERFORM pg_temp.check(pg_temp.delete_probe(2) = 'unresolved', 'dispatched request allowed deletion');

  uncertain := piggyvest_primary.claim_onboarding(pg_temp.scope(3), repeat('c', 64));
  PERFORM pg_temp.check(piggyvest_primary.record_onboarding(pg_temp.scope(3),
    (uncertain->>'intentId')::uuid, (uncertain->>'claimToken')::uuid, NULL, NULL),
    'unknown state setup failed');
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding_review(pg_temp.scope(3)) IS NULL,
    'non-rejected unknown intent returned a review reason');
  PERFORM pg_temp.check(pg_temp.delete_probe(3) = 'unresolved', 'unknown request allowed deletion');

  rejected := piggyvest_primary.claim_onboarding(pg_temp.scope(4), repeat('d', 64));
  PERFORM pg_temp.check(piggyvest_primary.record_onboarding_rejection(pg_temp.scope(4),
    (rejected->>'intentId')::uuid, (rejected->>'claimToken')::uuid), 'definitive rejection setup failed');
  PERFORM pg_temp.check((SELECT review_reason IS NULL FROM piggyvest_primary.onboarding_intents
    WHERE id = (rejected->>'intentId')::uuid), 'ordinary rejection acquired an ownership hold');
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding_review(pg_temp.scope(4)) = 'ownership',
    'legacy walletless rejection lost its review fallback');
  PERFORM pg_temp.check(pg_temp.delete_probe(4) = 'deleted',
    'walletless definitive rejection was held from deletion');
END $$;

-- Routing rejection stamps immutable status evidence. It remains unreadable
-- and non-spendable, blocks deletion only while its mapped DVA is open, and
-- is deletable after a valid closure attestation. Unlike the walletless
-- ownership hold, the routing label does not extend the DVA closure hold.
DO $$
DECLARE c jsonb; intent_id uuid;
BEGIN
  c := piggyvest_primary.claim_onboarding(pg_temp.scope(5), repeat('e', 64));
  intent_id := (c->>'intentId')::uuid;
  PERFORM pg_temp.check(piggyvest_primary.record_onboarding_routing_pending(pg_temp.scope(5),
    intent_id, (c->>'claimToken')::uuid, 'pv-customer-5', 'pv-wallet-5',
    '01JBZ8Q5W3X9R2K4M6N8P0T2V4'), 'routing-pending setup failed');
  PERFORM pg_temp.check(piggyvest_primary.resolve_onboarding_routing(pg_temp.scope(5),
    '{"providerCustomerId":"pv-customer-5","providerWalletId":"pv-wallet-5"}', false),
    'routing contradiction did not reject');
  PERFORM pg_temp.check((SELECT state = 'rejected' AND review_reason = 'routing'
      AND routing_payout_wallet_id IS NULL
    FROM piggyvest_primary.onboarding_intents WHERE id = intent_id),
    'routing rejection did not retain its reason after clearing the payout');
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding_review(pg_temp.scope(5)) = 'routing',
    'routing review reason not readable');
  PERFORM pg_temp.check(piggyvest_primary.claim_onboarding(pg_temp.scope(5), repeat('e', 64))
    = '{"status":"conflict"}'::jsonb, 'routing rejection was reclaimable');
  PERFORM pg_temp.check(piggyvest_primary.read_onboarding(pg_temp.scope(5)) IS NULL
      AND NOT piggyvest_primary.verify_onboarding(pg_temp.scope(5), pg_temp.verify_proof('pv-customer-5', 'pv-wallet-5')),
    'routing-rejected wallet became usable');
  PERFORM pg_temp.check(pg_temp.delete_probe(5) = 'open_dva',
    'unclosed mapped routing rejection did not retain the DVA guard');
  BEGIN
    UPDATE piggyvest_primary.onboarding_intents SET review_reason = NULL WHERE id = intent_id;
    RAISE EXCEPTION 'review reason clear unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM pg_temp.check((SELECT review_reason = 'routing'
    FROM piggyvest_primary.onboarding_intents WHERE id = intent_id), 'routing evidence was cleared');
  PERFORM piggyvest_primary.attest_provider_dva_closure(intent_id);
  PERFORM pg_temp.check(pg_temp.delete_probe(5) = 'deleted',
    'closed mapped routing rejection remained blocked by its review label');
END $$;

-- Both new RPCs and the trigger helper are absent from public client roles.
DO $$
DECLARE principal text;
BEGIN
  FOREACH principal IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    PERFORM pg_temp.check(NOT has_function_privilege(principal,
      'piggyvest_primary.record_onboarding_ownership_hold(jsonb,uuid,uuid)', 'EXECUTE'),
      principal || ' can record an ownership hold');
    PERFORM pg_temp.check(NOT has_function_privilege(principal,
      'piggyvest_primary.read_onboarding_review(jsonb)', 'EXECUTE'),
      principal || ' can read onboarding review');
    PERFORM pg_temp.check(NOT has_function_privilege(principal,
      'piggyvest_primary.guard_onboarding_review_reason()', 'EXECUTE'),
      principal || ' can execute the review trigger helper');
  END LOOP;
END $$;

COMMIT;
