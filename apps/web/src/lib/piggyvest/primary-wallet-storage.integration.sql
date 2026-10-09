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
\ir ../../../../../supabase/migrations/20261008091400_piggyvest_primary_onboarding_dispatched_lease.sql
\ir ../../../../../supabase/migrations/20261008093000_piggyvest_primary_onboarding_rejection.sql
INSERT INTO public.merchants VALUES ('00000000-0000-4000-8000-000000000001');
INSERT INTO public.customers VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003');
INSERT INTO public.customers VALUES ('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a');
INSERT INTO public.customers VALUES ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000c');
INSERT INTO public.customers VALUES ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000e');
CREATE TABLE public.stale_dispatch_fixture(intent_id uuid, claim_token uuid);
GRANT SELECT, INSERT ON public.stale_dispatch_fixture TO primary_fixture;
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
-- A dispatch whose holder died before recording must be reclaimable once
-- the lease expires, while a fresh dispatch still shares one provider
-- call. Row aging runs as the bootstrap role: the worker has no direct
-- table access by design.
SET SESSION AUTHORIZATION primary_fixture;
DO $$
DECLARE
  scope3 jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-00000000000b","userId":"00000000-0000-4000-8000-00000000000c","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  stale jsonb;
BEGIN
  stale := piggyvest_primary.claim_onboarding(scope3, repeat('e',64));
  IF stale->>'status' <> 'claimed' THEN RAISE EXCEPTION 'stale setup claim failed'; END IF;
  IF piggyvest_primary.claim_onboarding(scope3, repeat('e',64))->>'status' <> 'pending' THEN RAISE EXCEPTION 'fresh dispatch reclaimed'; END IF;
  INSERT INTO public.stale_dispatch_fixture(intent_id, claim_token) VALUES ((stale->>'intentId')::uuid, (stale->>'claimToken')::uuid);
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary.onboarding_intents SET updated_at = pg_catalog.clock_timestamp() - interval '6 minutes'
  WHERE customer_id = '00000000-0000-4000-8000-00000000000b';
SET SESSION AUTHORIZATION primary_fixture;
DO $$
DECLARE
  scope3 jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-00000000000b","userId":"00000000-0000-4000-8000-00000000000c","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  stale_token uuid := (SELECT claim_token FROM public.stale_dispatch_fixture LIMIT 1);
  revived jsonb;
BEGIN
  revived := piggyvest_primary.claim_onboarding(scope3, repeat('e',64));
  IF revived->>'status' <> 'claimed' OR revived->>'reclaimed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'stale dispatch stranded'; END IF;
  IF (revived->>'claimToken')::uuid = stale_token THEN RAISE EXCEPTION 'stale dispatch token reused'; END IF;
  IF piggyvest_primary.record_onboarding(scope3, (revived->>'intentId')::uuid, stale_token, 'customer', 'wallet') THEN RAISE EXCEPTION 'superseded dispatch token accepted'; END IF;
  IF NOT piggyvest_primary.record_onboarding(scope3, (revived->>'intentId')::uuid, (revived->>'claimToken')::uuid, 'revived-customer', 'revived-wallet') THEN RAISE EXCEPTION 'revived record failed'; END IF;
  IF piggyvest_primary.read_onboarding(scope3) <> '{"providerCustomerId":"revived-customer","providerWalletId":"revived-wallet"}'::jsonb THEN RAISE EXCEPTION 'revived mapping unreadable'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
-- An explicit existing-customer response is terminally rejected: retries
-- report conflict for owner review instead of reclaiming and adopting
-- the unrelated provider wallet.
SET SESSION AUTHORIZATION primary_fixture;
DO $$
DECLARE
  scope4 jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-00000000000d","userId":"00000000-0000-4000-8000-00000000000e","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  rejected jsonb;
BEGIN
  rejected := piggyvest_primary.claim_onboarding(scope4, repeat('f',64));
  IF rejected->>'status' <> 'claimed' THEN RAISE EXCEPTION 'rejection setup claim failed'; END IF;
  IF piggyvest_primary.record_onboarding_rejection(scope4, (rejected->>'intentId')::uuid, '00000000-0000-4000-8000-000000000005') THEN RAISE EXCEPTION 'stale rejection token accepted'; END IF;
  IF NOT piggyvest_primary.record_onboarding_rejection(scope4, (rejected->>'intentId')::uuid, (rejected->>'claimToken')::uuid) THEN RAISE EXCEPTION 'rejection record failed'; END IF;
  IF piggyvest_primary.record_onboarding_rejection(scope4, (rejected->>'intentId')::uuid, (rejected->>'claimToken')::uuid) THEN RAISE EXCEPTION 'rejection replayed'; END IF;
  IF piggyvest_primary.claim_onboarding(scope4, repeat('f',64))->>'status' <> 'conflict' THEN RAISE EXCEPTION 'rejected intent reclaimable'; END IF;
  IF piggyvest_primary.read_onboarding(scope4) IS NOT NULL THEN RAISE EXCEPTION 'rejected intent readable'; END IF;
  IF piggyvest_primary.record_onboarding(scope4, (rejected->>'intentId')::uuid, (rejected->>'claimToken')::uuid, 'adopted-customer', 'adopted-wallet') THEN RAISE EXCEPTION 'rejected intent adopted'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF has_function_privilege('authenticated', 'piggyvest_primary.claim_onboarding(jsonb,text)', 'EXECUTE') THEN RAISE EXCEPTION 'public claim granted'; END IF;
  IF has_function_privilege('authenticated', 'piggyvest_primary.record_onboarding_rejection(jsonb,uuid,uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'public rejection granted'; END IF;
  IF has_table_privilege('primary_fixture', 'piggyvest_primary.onboarding_intents', 'SELECT') THEN RAISE EXCEPTION 'worker direct table granted'; END IF;
END $$;
