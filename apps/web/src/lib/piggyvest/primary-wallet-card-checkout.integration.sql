\set ON_ERROR_STOP on
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE ROLE baci_primary_card_authorizer LOGIN;
CREATE ROLE baci_primary_card_evidence LOGIN;
CREATE TABLE public.merchants(id uuid PRIMARY KEY);
CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid REFERENCES public.merchants(id),user_id uuid,email text);
\ir ../../../../../supabase/migrations/20261007140000_piggyvest_primary_wallet_onboarding.sql
\ir ../../../../../supabase/migrations/20261007200000_primary_wallet_card_checkout_storage.sql
\ir ../../../../../supabase/migrations/20261007200100_primary_wallet_card_checkout_authorizer.sql
\ir ../../../../../supabase/migrations/20261007200200_primary_wallet_card_checkout_evidence.sql
INSERT INTO public.merchants VALUES('10000000-0000-4000-8000-000000000001');
INSERT INTO public.customers VALUES('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','customer@example.test');
INSERT INTO piggyvest_primary.integrations VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','fixture-business','staging','unused-provisioner',true);
INSERT INTO piggyvest_primary.onboarding_intents(integration_id,merchant_id,customer_id,user_id,request_fingerprint,state,provider_customer_id,provider_wallet_id)
VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',repeat('a',64),'verified','fixture-customer','fixture-primary');
INSERT INTO piggyvest_primary_card.settings VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','staging','fixture-business','baci_primary_card_authorizer','baci_primary_card_evidence','2099-01-01T00:00:00Z','https://example.test/wallet/card-return',true);
GRANT primary_card_authorizer TO baci_primary_card_authorizer;
GRANT primary_card_evidence TO baci_primary_card_evidence;
CREATE TABLE public.card_fixture(scope jsonb,operation_id uuid);
GRANT SELECT ON public.card_fixture TO baci_primary_card_authorizer,baci_primary_card_evidence;
INSERT INTO public.card_fixture(scope) VALUES('{"environment":"staging","integrationId":"10000000-0000-4000-8000-000000000004","merchantId":"10000000-0000-4000-8000-000000000001","customerId":"10000000-0000-4000-8000-000000000002","userId":"10000000-0000-4000-8000-000000000003","businessId":"fixture-business","email":"customer@example.test","expiresAt":"2099-01-01T00:00:00Z","callbackUrl":"https://example.test/wallet/card-return"}');
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
PREPARE primary_card_session AS SELECT
  (NOT role.rolsuper AND NOT role.rolbypassrls AND NOT role.rolcreaterole AND NOT role.rolcreatedb AND NOT role.rolreplication
    AND pg_has_role(SESSION_USER,$1,'MEMBER')
    AND NOT EXISTS(SELECT 1 FROM pg_roles parent
      WHERE parent.rolname NOT IN (SESSION_USER,$1) AND pg_has_role(SESSION_USER,parent.oid,'MEMBER'))
    AND NOT EXISTS(SELECT 1 FROM pg_roles capability WHERE capability.rolname=$1
      AND (capability.rolsuper OR capability.rolbypassrls OR capability.rolcreaterole OR capability.rolcreatedb OR capability.rolreplication))) AS safe
  FROM pg_roles role WHERE role.rolname=SESSION_USER;
EXECUTE primary_card_session('primary_card_authorizer');
DEALLOCATE primary_card_session;
DO $$ DECLARE
  scope jsonb := (SELECT scope FROM public.card_fixture);
  request jsonb := '{"idempotencyKey":"10000000-0000-4000-8000-000000000005","amountKobo":25000,"consent":{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}}';
  intent jsonb;
  claim jsonb;
  repeated jsonb;
BEGIN
  intent := piggyvest_primary_card.reserve(scope,request);
  repeated := piggyvest_primary_card.reserve(scope,request);
  IF intent <> repeated THEN RAISE EXCEPTION 'reservation duplicated'; END IF;
  BEGIN
    PERFORM piggyvest_primary_card.reserve(scope,jsonb_set(request,'{amountKobo}','24999'));
    RAISE EXCEPTION 'changed amount accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary_card.reserve(scope,jsonb_set(request,'{idempotencyKey}','"10000000-0000-4000-8000-000000000006"'));
    RAISE EXCEPTION 'second unresolved operation accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary_card.read_operation(jsonb_set(scope,'{userId}','"10000000-0000-4000-8000-000000000009"'),(intent->>'operationId')::uuid);
    RAISE EXCEPTION 'wrong user accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary_card.read_operation(jsonb_set(scope,'{environment}','"production"'),(intent->>'operationId')::uuid);
    RAISE EXCEPTION 'wrong environment accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary_card.read_operation(jsonb_set(scope,'{merchantId}','"10000000-0000-4000-8000-000000000009"'),(intent->>'operationId')::uuid);
    RAISE EXCEPTION 'wrong merchant accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary_card.read_operation(jsonb_set(scope,'{customerId}','"10000000-0000-4000-8000-000000000009"'),(intent->>'operationId')::uuid);
    RAISE EXCEPTION 'wrong customer accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary_card.read_operation(jsonb_set(scope,'{integrationId}','"10000000-0000-4000-8000-000000000009"'),(intent->>'operationId')::uuid);
    RAISE EXCEPTION 'wrong integration accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary_card.read_operation(jsonb_set(scope,'{expiresAt}','"2026-09-29T15:59:10Z"'),(intent->>'operationId')::uuid);
    RAISE EXCEPTION 'old deadline accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  claim := piggyvest_primary_card.claim_initialization(scope,(intent->>'operationId')::uuid);
  IF claim->>'outcome' <> 'claimed' THEN RAISE EXCEPTION 'first claim not acquired'; END IF;
  repeated := piggyvest_primary_card.claim_initialization(scope,(intent->>'operationId')::uuid);
  IF repeated->>'outcome' <> 'existing' THEN RAISE EXCEPTION 'initialization repeated'; END IF;
  IF piggyvest_primary_card.record_initialization(scope,(intent->>'operationId')::uuid,'10000000-0000-4000-8000-000000000009',NULL) THEN RAISE EXCEPTION 'stale token accepted'; END IF;
  IF NOT piggyvest_primary_card.record_initialization(scope,(intent->>'operationId')::uuid,(claim->>'token')::uuid,NULL) THEN RAISE EXCEPTION 'unknown result not durable'; END IF;
  IF piggyvest_primary_card.claim_initialization(scope,(intent->>'operationId')::uuid)->>'outcome' <> 'existing' THEN RAISE EXCEPTION 'ambiguous collection retried'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.card_fixture SET operation_id=(SELECT id FROM piggyvest_primary_card.operations);
SET SESSION AUTHORIZATION baci_primary_card_evidence;
DO $$ DECLARE
  scope jsonb := (SELECT scope FROM public.card_fixture);
  operation_id uuid := (SELECT operation_id FROM public.card_fixture);
  collection jsonb := jsonb_build_object('reference','pvb-first-primary-'||operation_id::text,'amountKobo',25000,'domain','test','providerTransactionId','12345','token',NULL);
BEGIN
  BEGIN
    PERFORM piggyvest_primary_card.record_collection(scope,operation_id,jsonb_set(collection,'{domain}','"live"'));
    RAISE EXCEPTION 'live collection accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary_card.record_collection(scope,operation_id,jsonb_set(collection,'{token}','{"authorizationCode":"AUTH_fixture","customerCode":"CUS_fixture","email":"customer@example.test","reusable":true}'));
    RAISE EXCEPTION 'token saved without consent';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF NOT piggyvest_primary_card.record_collection(scope,operation_id,collection) THEN RAISE EXCEPTION 'one-time collection rejected'; END IF;
  IF NOT piggyvest_primary_card.record_collection(scope,operation_id,collection) THEN RAISE EXCEPTION 'duplicate collection rejected'; END IF;
  BEGIN
    PERFORM piggyvest_primary_card.record_collection(scope,operation_id,jsonb_set(collection,'{providerTransactionId}','"12346"'));
    RAISE EXCEPTION 'changed collection identity accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT state FROM piggyvest_primary_card.operations) <> 'custody_pending' THEN RAISE EXCEPTION 'Paystack completed custody'; END IF;
  IF (SELECT saved_token FROM piggyvest_primary_card.collections) IS NOT NULL THEN RAISE EXCEPTION 'unconsented token retained'; END IF;
  IF has_function_privilege('authenticated','piggyvest_primary_card.reserve(jsonb,jsonb)','EXECUTE') OR has_function_privilege('service_role','piggyvest_primary_card.reserve(jsonb,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'public/service authorizer granted'; END IF;
  IF has_function_privilege('baci_primary_card_authorizer','piggyvest_primary_card.record_collection(jsonb,uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'authorizer can forge collection'; END IF;
  IF has_function_privilege('baci_primary_card_evidence','piggyvest_primary_card.claim_initialization(jsonb,uuid)','EXECUTE') THEN RAISE EXCEPTION 'evidence can initialize'; END IF;
  IF has_table_privilege('baci_primary_card_evidence','piggyvest_primary_card.collections','SELECT') THEN RAISE EXCEPTION 'private tokens readable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='piggyvest_primary_card.collections'::regclass AND relrowsecurity) THEN RAISE EXCEPTION 'RLS disabled'; END IF;
END $$;
INSERT INTO public.customers VALUES('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','second@example.test');
INSERT INTO piggyvest_primary.onboarding_intents(integration_id,merchant_id,customer_id,user_id,request_fingerprint,state,provider_customer_id,provider_wallet_id)
VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003',repeat('b',64),'verified','second-customer','second-primary');
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE
  scope jsonb := (SELECT scope FROM public.card_fixture);
  intent jsonb;
  claim jsonb;
  session jsonb;
BEGIN
  scope := scope || '{"customerId":"20000000-0000-4000-8000-000000000002","userId":"20000000-0000-4000-8000-000000000003","email":"second@example.test"}';
  intent := piggyvest_primary_card.reserve(scope,'{"idempotencyKey":"20000000-0000-4000-8000-000000000005","amountKobo":25000,"consent":{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":true}}');
  claim := piggyvest_primary_card.claim_initialization(scope,(intent->>'operationId')::uuid);
  session := jsonb_build_object('reference',intent->>'reference','authorizationUrl','https://checkout.paystack.com/fixture123');
  IF NOT piggyvest_primary_card.record_initialization(scope,(intent->>'operationId')::uuid,(claim->>'token')::uuid,session) THEN RAISE EXCEPTION 'session not persisted'; END IF;
  IF piggyvest_primary_card.read_operation(scope,(intent->>'operationId')::uuid)->>'authorizationUrl' <> session->>'authorizationUrl' THEN RAISE EXCEPTION 'read lost session'; END IF;
  IF piggyvest_primary_card.claim_initialization(scope,(intent->>'operationId')::uuid)->>'outcome' <> 'existing' THEN RAISE EXCEPTION 'ready session reinitialized'; END IF;
  BEGIN
    PERFORM piggyvest_primary_card.read_operation(scope,(SELECT operation_id FROM public.card_fixture));
    RAISE EXCEPTION 'sibling operation readable';
  EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
INSERT INTO public.card_fixture(scope,operation_id)
SELECT original.scope || '{"customerId":"20000000-0000-4000-8000-000000000002","userId":"20000000-0000-4000-8000-000000000003","email":"second@example.test"}',operation.id
FROM public.card_fixture original JOIN piggyvest_primary_card.operations operation ON operation.customer_id='20000000-0000-4000-8000-000000000002';
SET SESSION AUTHORIZATION baci_primary_card_evidence;
DO $$ DECLARE
  scope jsonb := (SELECT scope FROM public.card_fixture WHERE scope->>'email'='second@example.test');
  operation_id uuid := (SELECT fixture.operation_id FROM public.card_fixture fixture WHERE fixture.scope->>'email'='second@example.test');
  collection jsonb := jsonb_build_object('reference','pvb-first-primary-'||operation_id::text,'amountKobo',25000,'domain','test','providerTransactionId','12345','token',NULL);
BEGIN
  BEGIN
    PERFORM piggyvest_primary_card.record_collection(scope,operation_id,collection);
    RAISE EXCEPTION 'collection transaction reused across operations';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  collection := jsonb_set(collection,'{providerTransactionId}','"12346"');
  collection := jsonb_set(collection,'{token}','{"authorizationCode":"AUTH_fixture","customerCode":"CUS_fixture","email":"second@example.test","reusable":true}');
  IF NOT piggyvest_primary_card.record_collection(scope,operation_id,collection) THEN RAISE EXCEPTION 'consented reusable token not stored'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT count(*) FROM piggyvest_primary_card.collections) <> 2 THEN RAISE EXCEPTION 'unexpected collection count'; END IF;
  IF EXISTS(SELECT 1 FROM piggyvest_primary_card.operations WHERE state <> 'custody_pending') THEN RAISE EXCEPTION 'collection bypassed custody pending'; END IF;
  IF NOT EXISTS(SELECT 1 FROM piggyvest_primary_card.collections WHERE saved_token IS NOT NULL) THEN RAISE EXCEPTION 'consented token missing'; END IF;
END $$;
-- Provider checkout URL variants (hostname validation follow-up): the
-- pre-migration single-segment regex rejects legitimate provider URLs with
-- extra segments, hyphens, or query strings. Negative control first.
INSERT INTO public.customers VALUES('51000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000003','urlvariant@example.test');
INSERT INTO piggyvest_primary.onboarding_intents(integration_id,merchant_id,customer_id,user_id,request_fingerprint,state,provider_customer_id,provider_wallet_id)
VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000003',repeat('c',64),'verified','variant-customer','variant-primary');
CREATE TEMP TABLE card_variant_fixture(operation_id uuid, token uuid);
GRANT SELECT, INSERT ON card_variant_fixture TO baci_primary_card_authorizer;
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE
  scope jsonb := (SELECT scope FROM public.card_fixture LIMIT 1);
  intent jsonb;
  claim jsonb;
  session jsonb;
BEGIN
  scope := scope || '{"customerId":"51000000-0000-4000-8000-000000000002","userId":"51000000-0000-4000-8000-000000000003","email":"urlvariant@example.test"}';
  intent := piggyvest_primary_card.reserve(scope,'{"idempotencyKey":"51000000-0000-4000-8000-000000000005","amountKobo":25000,"consent":{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}}');
  claim := piggyvest_primary_card.claim_initialization(scope,(intent->>'operationId')::uuid);
  INSERT INTO card_variant_fixture VALUES((intent->>'operationId')::uuid,(claim->>'token')::uuid);
  session := jsonb_build_object('reference',intent->>'reference','authorizationUrl','https://checkout.paystack.com/pay/fixture-123_ABC?reference=xyz');
  BEGIN
    PERFORM piggyvest_primary_card.record_initialization(scope,(intent->>'operationId')::uuid,(claim->>'token')::uuid,session);
    RAISE EXCEPTION 'provider URL variant accepted before hostname migration';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
\ir ../../../../../supabase/migrations/20261008090500_primary_card_checkout_url_hostname.sql
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE
  scope jsonb := (SELECT scope FROM public.card_fixture LIMIT 1);
  operation_id uuid := (SELECT fixture.operation_id FROM card_variant_fixture fixture);
  token uuid := (SELECT fixture.token FROM card_variant_fixture fixture);
  intent jsonb;
  session jsonb;
BEGIN
  scope := scope || '{"customerId":"51000000-0000-4000-8000-000000000002","userId":"51000000-0000-4000-8000-000000000003","email":"urlvariant@example.test"}';
  intent := piggyvest_primary_card.read_operation(scope,operation_id);
  session := jsonb_build_object('reference',intent->>'reference','authorizationUrl','https://checkout.paystack.com/pay/fixture-123_ABC?reference=xyz');
  IF NOT piggyvest_primary_card.record_initialization(scope,operation_id,token,session) THEN RAISE EXCEPTION 'provider URL variant rejected after hostname migration'; END IF;
  IF piggyvest_primary_card.read_operation(scope,operation_id)->>'authorizationUrl' <> session->>'authorizationUrl' THEN RAISE EXCEPTION 'variant session lost'; END IF;
  FOR session IN SELECT jsonb_build_object('reference',intent->>'reference','authorizationUrl',url) FROM (VALUES
    ('http://checkout.paystack.com/fixture123'),
    ('https://checkout.paystack.com.evil.example.com/fixture123'),
    ('https://checkout.paystack.com@evil.example.com/'),
    ('https://evil.example.com/checkout.paystack.com/x')) AS lookalike(url) LOOP
    BEGIN
      PERFORM piggyvest_primary_card.record_initialization(scope,operation_id,token,session);
      RAISE EXCEPTION 'lookalike checkout host accepted: %', session->>'authorizationUrl';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  BEGIN
    UPDATE piggyvest_primary_card.operations SET authorization_url='https://checkout.paystack.com.evil.example.com/x'
    WHERE customer_id='51000000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'table constraint accepted lookalike host';
  EXCEPTION WHEN check_violation THEN NULL; END;
  DELETE FROM piggyvest_primary_card.operations WHERE customer_id='51000000-0000-4000-8000-000000000002';
END $$;
\ir ../../../../../supabase/migrations/20261008090600_primary_card_claim_reclaim.sql
\ir ../../../../../supabase/migrations/20261008090700_primary_card_abandoned_release.sql
\ir ../../../../../supabase/migrations/20261008090800_primary_card_claim_lease.sql
\ir ../../../../../supabase/migrations/20261008090900_primary_card_reserve_recovery.sql
-- Lease-gated stale-claim reclaim and abandoned-checkout release: a crash
-- between claim and record must not strand the operation, overlapping
-- initialize requests must share one claim (Paystack rejects repeated
-- references), and a provider-abandoned checkout must terminalize so the
-- customer can start a fresh operation.
INSERT INTO public.customers VALUES('60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000003','reclaim@example.test');
INSERT INTO piggyvest_primary.onboarding_intents(integration_id,merchant_id,customer_id,user_id,request_fingerprint,state,provider_customer_id,provider_wallet_id)
VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000003',repeat('d',64),'verified','reclaim-customer','reclaim-primary');
CREATE TEMP TABLE card_reclaim_fixture(operation_id uuid, token uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON card_reclaim_fixture TO baci_primary_card_authorizer, baci_primary_card_evidence;
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE
  scope jsonb := (SELECT scope FROM public.card_fixture LIMIT 1);
  intent jsonb;
  claim jsonb;
  overlapping jsonb;
BEGIN
  scope := scope || '{"customerId":"60000000-0000-4000-8000-000000000002","userId":"60000000-0000-4000-8000-000000000003","email":"reclaim@example.test"}';
  intent := piggyvest_primary_card.reserve(scope,'{"idempotencyKey":"60000000-0000-4000-8000-000000000005","amountKobo":25000,"consent":{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}}');
  claim := piggyvest_primary_card.claim_initialization(scope,(intent->>'operationId')::uuid);
  IF claim->>'outcome' <> 'claimed' THEN RAISE EXCEPTION 'reclaim fixture not claimed'; END IF;
  INSERT INTO card_reclaim_fixture VALUES((intent->>'operationId')::uuid,(claim->>'token')::uuid);
  overlapping := piggyvest_primary_card.claim_initialization(scope,(intent->>'operationId')::uuid);
  IF overlapping->>'outcome' <> 'existing' THEN RAISE EXCEPTION 'fresh claim token replaced'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary_card.operations SET updated_at=clock_timestamp()-interval '6 minutes'
WHERE id=(SELECT fixture.operation_id FROM card_reclaim_fixture fixture);
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE
  scope jsonb := (SELECT scope FROM public.card_fixture LIMIT 1);
  operation_id uuid := (SELECT fixture.operation_id FROM card_reclaim_fixture fixture);
  intent jsonb;
  reclaimed jsonb;
  session jsonb;
BEGIN
  scope := scope || '{"customerId":"60000000-0000-4000-8000-000000000002","userId":"60000000-0000-4000-8000-000000000003","email":"reclaim@example.test"}';
  intent := piggyvest_primary_card.read_operation(scope,operation_id);
  reclaimed := piggyvest_primary_card.claim_initialization(scope,operation_id);
  IF reclaimed->>'outcome' <> 'claimed' THEN RAISE EXCEPTION 'stale claim not reclaimed'; END IF;
  IF (reclaimed->>'token')::uuid = (SELECT fixture.token FROM card_reclaim_fixture fixture) THEN RAISE EXCEPTION 'reclaim reused token'; END IF;
  IF piggyvest_primary_card.record_initialization(scope,operation_id,(SELECT fixture.token FROM card_reclaim_fixture fixture),NULL) THEN RAISE EXCEPTION 'superseded token accepted'; END IF;
  session := jsonb_build_object('reference',intent->>'reference','authorizationUrl','https://checkout.paystack.com/reclaim123');
  IF NOT piggyvest_primary_card.record_initialization(scope,operation_id,(reclaimed->>'token')::uuid,session) THEN RAISE EXCEPTION 'reclaimed session not persisted'; END IF;
  IF piggyvest_primary_card.read_operation(scope,operation_id)->>'status' <> 'ready' THEN RAISE EXCEPTION 'reclaim did not reach ready'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_card_evidence;
DO $$ DECLARE
  scope jsonb := (SELECT scope FROM public.card_fixture LIMIT 1);
  operation_id uuid := (SELECT fixture.operation_id FROM card_reclaim_fixture fixture);
BEGIN
  scope := scope || '{"customerId":"60000000-0000-4000-8000-000000000002","userId":"60000000-0000-4000-8000-000000000003","email":"reclaim@example.test"}';
  IF NOT piggyvest_primary_card.record_abandonment(scope,operation_id) THEN RAISE EXCEPTION 'ready checkout not abandoned'; END IF;
  IF NOT piggyvest_primary_card.record_abandonment(scope,operation_id) THEN RAISE EXCEPTION 'abandonment not idempotent'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE
  scope jsonb := (SELECT scope FROM public.card_fixture LIMIT 1);
  fresh jsonb;
  recovered jsonb;
BEGIN
  scope := scope || '{"customerId":"60000000-0000-4000-8000-000000000002","userId":"60000000-0000-4000-8000-000000000003","email":"reclaim@example.test"}';
  fresh := piggyvest_primary_card.reserve(scope,'{"idempotencyKey":"60000000-0000-4000-8000-000000000006","amountKobo":25000,"consent":{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}}');
  DELETE FROM card_reclaim_fixture;
  INSERT INTO card_reclaim_fixture(operation_id) VALUES((fresh->>'operationId')::uuid);
  IF fresh->>'status' <> 'reserved' THEN RAISE EXCEPTION 'abandoned operation still blocks retry'; END IF;
  IF piggyvest_primary_card.reserve(scope,'{"idempotencyKey":"60000000-0000-4000-8000-000000000005","amountKobo":25000,"consent":{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}}')->>'status' <> 'abandoned' THEN RAISE EXCEPTION 'same-key reserve lost abandonment'; END IF;
  recovered := piggyvest_primary_card.reserve(scope,'{"idempotencyKey":"60000000-0000-4000-8000-000000000007","amountKobo":25000,"consent":{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}}');
  IF recovered->>'operationId' <> fresh->>'operationId' OR recovered->>'status' <> 'reserved' THEN RAISE EXCEPTION 'reinstall recovery lost operation'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_card_evidence;
DO $$ DECLARE
  scope jsonb := (SELECT scope FROM public.card_fixture LIMIT 1);
  reserved_id uuid := (SELECT fixture.operation_id FROM card_reclaim_fixture fixture);
  custody_scope jsonb := (SELECT card.scope FROM public.card_fixture card WHERE card.scope->>'email'='customer@example.test');
  custody_id uuid := (SELECT fixture.operation_id FROM public.card_fixture fixture WHERE fixture.scope->>'email'='customer@example.test');
BEGIN
  scope := scope || '{"customerId":"60000000-0000-4000-8000-000000000002","userId":"60000000-0000-4000-8000-000000000003","email":"reclaim@example.test"}';
  IF piggyvest_primary_card.record_abandonment(scope,reserved_id) THEN RAISE EXCEPTION 'reserved operation abandoned'; END IF;
  IF piggyvest_primary_card.record_abandonment(custody_scope,custody_id) THEN RAISE EXCEPTION 'custody-bound operation abandoned'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF NOT has_function_privilege('baci_primary_card_evidence','piggyvest_primary_card.record_abandonment(jsonb,uuid)','EXECUTE') THEN RAISE EXCEPTION 'evidence cannot record abandonment'; END IF;
  IF has_function_privilege('baci_primary_card_authorizer','piggyvest_primary_card.record_abandonment(jsonb,uuid)','EXECUTE') THEN RAISE EXCEPTION 'authorizer can abandon evidence'; END IF;
  IF has_function_privilege('authenticated','piggyvest_primary_card.record_abandonment(jsonb,uuid)','EXECUTE') OR has_function_privilege('service_role','piggyvest_primary_card.record_abandonment(jsonb,uuid)','EXECUTE') THEN RAISE EXCEPTION 'public/service abandonment granted'; END IF;
  DELETE FROM piggyvest_primary_card.operations WHERE customer_id='60000000-0000-4000-8000-000000000002';
END $$;
\ir ../../../../../supabase/migrations/20261008091100_primary_card_paystack_minimum.sql
-- Paystack minimum: below-5000 reservations fail before storage, and the
-- table CHECK pins the floor even for direct writes.
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE
  scope jsonb := (SELECT scope FROM public.card_fixture LIMIT 1);
  floor jsonb;
BEGIN
  scope := scope || '{"customerId":"60000000-0000-4000-8000-000000000002","userId":"60000000-0000-4000-8000-000000000003","email":"reclaim@example.test"}';
  BEGIN
    PERFORM piggyvest_primary_card.reserve(scope,'{"idempotencyKey":"60000000-0000-4000-8000-000000000009","amountKobo":4999,"consent":{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}}');
    RAISE EXCEPTION 'below-minimum reservation accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  floor := piggyvest_primary_card.reserve(scope,'{"idempotencyKey":"60000000-0000-4000-8000-000000000010","amountKobo":5000,"consent":{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}}');
  IF floor->>'status' <> 'reserved' THEN RAISE EXCEPTION 'minimum reservation rejected'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  BEGIN
    INSERT INTO piggyvest_primary_card.operations(integration_id,merchant_id,customer_id,user_id,environment,business_id,email,idempotency_key,amount_kobo,consent,fingerprint,destination_wallet_id,destination_customer_id,state)
    VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000003','staging','fixture-business','reclaim@example.test','60000000-0000-4000-8000-000000000011',4999,'{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}',repeat('e',64),'reclaim-primary','reclaim-customer','reserved');
    RAISE EXCEPTION 'table constraint accepted below-minimum amount';
  EXCEPTION WHEN check_violation THEN NULL; END;
  DELETE FROM piggyvest_primary_card.operations WHERE customer_id='60000000-0000-4000-8000-000000000002';
END $$;
\ir ../../../../../supabase/migrations/20261008091200_primary_card_identity_without_email.sql
-- Profile email changes must not break recovery: the webhook carries the
-- original address while the client carries the new one, and both must
-- read by immutable IDs.
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE
  scope jsonb := (SELECT scope FROM public.card_fixture LIMIT 1);
  intent jsonb;
BEGIN
  scope := scope || '{"customerId":"60000000-0000-4000-8000-000000000002","userId":"60000000-0000-4000-8000-000000000003","email":"reclaim@example.test"}';
  intent := piggyvest_primary_card.reserve(scope,'{"idempotencyKey":"60000000-0000-4000-8000-000000000012","amountKobo":25000,"consent":{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}}');
  DELETE FROM card_reclaim_fixture;
  INSERT INTO card_reclaim_fixture(operation_id) VALUES((intent->>'operationId')::uuid);
END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.customers SET email='reclaim-changed@example.test' WHERE id='60000000-0000-4000-8000-000000000002';
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE
  base jsonb := (SELECT scope FROM public.card_fixture LIMIT 1);
  operation_id uuid := (SELECT fixture.operation_id FROM card_reclaim_fixture fixture);
BEGIN
  IF piggyvest_primary_card.read_operation(base||'{"customerId":"60000000-0000-4000-8000-000000000002","userId":"60000000-0000-4000-8000-000000000003","email":"reclaim-changed@example.test"}',operation_id)->>'status' <> 'reserved' THEN RAISE EXCEPTION 'client recovery failed after email change'; END IF;
  IF piggyvest_primary_card.read_operation(base||'{"customerId":"60000000-0000-4000-8000-000000000002","userId":"60000000-0000-4000-8000-000000000003","email":"reclaim@example.test"}',operation_id)->>'status' <> 'reserved' THEN RAISE EXCEPTION 'webhook recovery failed after email change'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  DELETE FROM piggyvest_primary_card.operations WHERE customer_id='60000000-0000-4000-8000-000000000002';
  UPDATE public.customers SET email='reclaim@example.test' WHERE id='60000000-0000-4000-8000-000000000002';
END $$;
