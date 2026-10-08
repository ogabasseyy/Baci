\set ON_ERROR_STOP on
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE ROLE primary_fixture LOGIN;
CREATE TABLE public.merchants(id uuid PRIMARY KEY);
CREATE TABLE public.customers(id uuid PRIMARY KEY, merchant_id uuid REFERENCES public.merchants(id), user_id uuid);
\ir ../../../../../supabase/migrations/20261007140000_piggyvest_primary_wallet_onboarding.sql
\ir ../../../../../supabase/migrations/20261007141000_piggyvest_primary_wallet_mapping_read.sql
\ir ../../../../../supabase/migrations/20261008090200_piggyvest_primary_onboarding_reclaim.sql
INSERT INTO public.merchants VALUES ('00000000-0000-4000-8000-000000000001');
INSERT INTO public.customers VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003');
INSERT INTO public.customers VALUES ('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a');
INSERT INTO piggyvest_primary.integrations VALUES ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'fixture-business', 'staging', 'primary_fixture', true);
GRANT piggyvest_primary_provisioner TO primary_fixture;
SET SESSION AUTHORIZATION primary_fixture;
DO $$
DECLARE
  scope jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  scope2 jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000009","userId":"00000000-0000-4000-8000-00000000000a","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  first_claim jsonb;
  subsequent jsonb;
  uncertain_claim jsonb;
  reclaimed jsonb;
BEGIN
  first_claim := piggyvest_primary.claim_onboarding(scope, repeat('a',64));
  IF first_claim->>'status' <> 'claimed' THEN RAISE EXCEPTION 'first claim failed'; END IF;
  IF first_claim->>'reclaimed' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'fresh claim misflagged'; END IF;
  subsequent := piggyvest_primary.claim_onboarding(scope, repeat('a',64));
  IF subsequent->>'status' <> 'pending' THEN RAISE EXCEPTION 'duplicate dispatched'; END IF;
  subsequent := piggyvest_primary.claim_onboarding(scope, repeat('b',64));
  IF subsequent->>'status' <> 'conflict' THEN RAISE EXCEPTION 'changed identity accepted'; END IF;
  IF piggyvest_primary.record_onboarding(scope, (first_claim->>'intentId')::uuid, '00000000-0000-4000-8000-000000000005', 'customer', 'wallet') THEN RAISE EXCEPTION 'stale token accepted'; END IF;
  IF NOT piggyvest_primary.record_onboarding(scope, (first_claim->>'intentId')::uuid, (first_claim->>'claimToken')::uuid, 'customer', 'wallet') THEN RAISE EXCEPTION 'accept failed'; END IF;
  IF piggyvest_primary.read_onboarding(scope) <> '{"providerCustomerId":"customer","providerWalletId":"wallet"}'::jsonb THEN RAISE EXCEPTION 'mapping read mismatch'; END IF;
  IF piggyvest_primary.record_onboarding(scope, (first_claim->>'intentId')::uuid, (first_claim->>'claimToken')::uuid, 'replacement', 'replacement') THEN RAISE EXCEPTION 'repeat overwrote identity'; END IF;
  uncertain_claim := piggyvest_primary.claim_onboarding(scope2, repeat('c',64));
  IF uncertain_claim->>'status' <> 'claimed' THEN RAISE EXCEPTION 'uncertain setup claim failed'; END IF;
  IF NOT piggyvest_primary.record_onboarding(scope2, (uncertain_claim->>'intentId')::uuid, (uncertain_claim->>'claimToken')::uuid, NULL, NULL) THEN RAISE EXCEPTION 'uncertain record failed'; END IF;
  IF piggyvest_primary.read_onboarding(scope2) IS NOT NULL THEN RAISE EXCEPTION 'unknown intent readable'; END IF;
  IF piggyvest_primary.claim_onboarding(scope2, repeat('d',64))->>'status' <> 'conflict' THEN RAISE EXCEPTION 'unknown intent adopted by foreign request'; END IF;
  reclaimed := piggyvest_primary.claim_onboarding(scope2, repeat('c',64));
  IF reclaimed->>'status' <> 'claimed' OR reclaimed->>'reclaimed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'unknown intent stranded'; END IF;
  IF NOT piggyvest_primary.record_onboarding(scope2, (reclaimed->>'intentId')::uuid, (reclaimed->>'claimToken')::uuid, 'adopted-customer', 'adopted-wallet') THEN RAISE EXCEPTION 'adopted record failed'; END IF;
  IF piggyvest_primary.read_onboarding(scope2) <> '{"providerCustomerId":"adopted-customer","providerWalletId":"adopted-wallet"}'::jsonb THEN RAISE EXCEPTION 'adopted mapping unreadable'; END IF;
  BEGIN
    PERFORM piggyvest_primary.claim_onboarding(jsonb_set(scope, '{userId}', '"00000000-0000-4000-8000-000000000005"'), repeat('a',64));
    RAISE EXCEPTION 'ownership mismatch accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF has_function_privilege('authenticated', 'piggyvest_primary.claim_onboarding(jsonb,text)', 'EXECUTE') THEN RAISE EXCEPTION 'public claim granted'; END IF;
  IF has_table_privilege('primary_fixture', 'piggyvest_primary.onboarding_intents', 'SELECT') THEN RAISE EXCEPTION 'worker direct table granted'; END IF;
END $$;
