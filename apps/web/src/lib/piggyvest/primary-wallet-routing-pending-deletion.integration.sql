\set ON_ERROR_STOP on
-- Wallet-bearing protections follow the provider wallet (20261031230000):
-- a customer whose onboarding intent is routing_pending, or rejected over
-- its routing, still holds a PiggyVest wallet with an open DVA, so deleting
-- the customer must wait for the closure attestation, and a recheck after
-- that closure never promotes the wallet to usable. An intent without
-- provider ids never locks the customer.
\ir primary-wallet-storage.integration.sql
\ir ../../../../../supabase/migrations/20261007180000_piggyvest_primary_wallet_verification.sql
\ir ../../../../../supabase/migrations/20261007230000_primary_bank_signed_inbox.sql
\ir ../../../../../supabase/migrations/20261008093700_primary_bank_inbox_unsettled_deletion_block.sql
\ir ../../../../../supabase/migrations/20261008095500_primary_bank_deletion_requires_dva_closure.sql
\ir ../../../../../supabase/migrations/20261031230000_piggyvest_primary_onboarding_routing_pending.sql
INSERT INTO public.merchants VALUES ('a3400000-0000-4000-8000-000000000002');
INSERT INTO public.customers VALUES
  ('a3400000-0000-4000-8000-000000000011', 'a3400000-0000-4000-8000-000000000002', 'a3400000-0000-4000-8000-000000000021'),
  ('a3400000-0000-4000-8000-000000000012', 'a3400000-0000-4000-8000-000000000002', 'a3400000-0000-4000-8000-000000000022'),
  ('a3400000-0000-4000-8000-000000000013', 'a3400000-0000-4000-8000-000000000002', 'a3400000-0000-4000-8000-000000000023');
INSERT INTO piggyvest_primary.integrations VALUES ('a3400000-0000-4000-8000-000000000005',
  'a3400000-0000-4000-8000-000000000002', 'routing-deletion-business', 'staging', session_user, true);
CREATE FUNCTION pg_temp.scope(p_n int) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('merchantId', 'a3400000-0000-4000-8000-000000000002',
    'customerId', 'a3400000-0000-4000-8000-00000000001' || p_n, 'userId', 'a3400000-0000-4000-8000-00000000002' || p_n,
    'integrationId', 'a3400000-0000-4000-8000-000000000005', 'businessId', 'routing-deletion-business', 'environment', 'staging')
$$;
-- Deleting customer n: 'dva' when the open-DVA guard refuses it, 'other'
-- when anything else stops it (here the intent's foreign key), else 'deleted'.
CREATE FUNCTION pg_temp.delete_customer(p_n int) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.customers WHERE id = ('a3400000-0000-4000-8000-00000000001' || p_n)::uuid;
  RETURN 'deleted';
EXCEPTION
  WHEN raise_exception THEN
    RETURN CASE WHEN SQLERRM = 'cannot delete customer with open provider DVA' THEN 'dva' ELSE 'other:' || SQLERRM END;
  WHEN foreign_key_violation THEN RETURN 'other';
END $$;
DO $$
DECLARE v_claim jsonb; v_intent uuid;
BEGIN
  -- Routing pending: blocked until the DVA closure is attested.
  v_claim := piggyvest_primary.claim_onboarding(pg_temp.scope(1), repeat('a', 64));
  v_intent := (v_claim->>'intentId')::uuid;
  IF NOT piggyvest_primary.record_onboarding_routing_pending(pg_temp.scope(1), v_intent, (v_claim->>'claimToken')::uuid,
    'pv-customer-1', 'pv-wallet-1', '01JBZ8Q5W3X9R2K4M6N8P0T2V4') THEN RAISE EXCEPTION 'routing pending not recorded'; END IF;
  IF pg_temp.delete_customer(1) <> 'dva' THEN RAISE EXCEPTION 'a routing-pending DVA did not block deletion'; END IF;
  PERFORM piggyvest_primary.attest_provider_dva_closure(v_intent);
  IF NOT piggyvest_primary.resolve_onboarding_routing(pg_temp.scope(1),
    '{"providerCustomerId":"pv-customer-1","providerWalletId":"pv-wallet-1"}', true) THEN RAISE EXCEPTION 'closed recheck not resolved'; END IF;
  IF (SELECT state FROM piggyvest_primary.onboarding_intents WHERE id = v_intent) <> 'rejected' THEN
    RAISE EXCEPTION 'a closed DVA was promoted to a usable wallet'; END IF;
  IF pg_temp.delete_customer(1) = 'dva' THEN RAISE EXCEPTION 'an attested closure still blocked deletion'; END IF;
  -- Rejected over its routing: the ids are kept, so the guard still applies.
  v_claim := piggyvest_primary.claim_onboarding(pg_temp.scope(2), repeat('b', 64));
  IF NOT piggyvest_primary.record_onboarding_routing_pending(pg_temp.scope(2), (v_claim->>'intentId')::uuid,
    (v_claim->>'claimToken')::uuid, 'pv-customer-2', 'pv-wallet-2', '01JBZ8Q5W3X9R2K4M6N8P0T2V4') THEN RAISE EXCEPTION 'second routing pending not recorded'; END IF;
  IF NOT piggyvest_primary.resolve_onboarding_routing(pg_temp.scope(2),
    '{"providerCustomerId":"pv-customer-2","providerWalletId":"pv-wallet-2"}', false) THEN RAISE EXCEPTION 'contradiction not resolved'; END IF;
  IF pg_temp.delete_customer(2) <> 'dva' THEN RAISE EXCEPTION 'a routing-rejected DVA did not block deletion'; END IF;
  -- No provider ids yet (still dispatched): never locked by the DVA guard.
  PERFORM piggyvest_primary.claim_onboarding(pg_temp.scope(3), repeat('c', 64));
  IF pg_temp.delete_customer(3) = 'dva' THEN RAISE EXCEPTION 'a walletless intent locked deletion'; END IF;
END $$;
