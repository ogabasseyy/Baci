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
\ir ../../../../../supabase/migrations/20261008090500_primary_card_checkout_url_hostname.sql
\ir ../../../../../supabase/migrations/20261008090600_primary_card_claim_reclaim.sql
\ir ../../../../../supabase/migrations/20261008090700_primary_card_abandoned_release.sql
\ir ../../../../../supabase/migrations/20261008090800_primary_card_claim_lease.sql
\ir ../../../../../supabase/migrations/20261008090900_primary_card_reserve_recovery.sql
\ir ../../../../../supabase/migrations/20261008091100_primary_card_paystack_minimum.sql
\ir ../../../../../supabase/migrations/20261008091200_primary_card_identity_without_email.sql
\ir ../../../../../supabase/migrations/20261008091500_primary_card_stale_init_reentry.sql
\ir ../../../../../supabase/migrations/20261008092300_primary_card_expiry_drain.sql
INSERT INTO public.merchants VALUES('10000000-0000-4000-8000-000000000001');
INSERT INTO public.customers VALUES
  ('70000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000003','drain-read@example.test'),
  ('70000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000013','drain-flag@example.test'),
  ('70000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000023','drain-abandon@example.test');
INSERT INTO piggyvest_primary.integrations VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','fixture-business','staging','unused-provisioner',true);
INSERT INTO piggyvest_primary.onboarding_intents(integration_id,merchant_id,customer_id,user_id,request_fingerprint,state,provider_customer_id,provider_wallet_id)
VALUES
  ('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000003',repeat('e',64),'verified','drain-read','drain-read-wallet'),
  ('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000012','70000000-0000-4000-8000-000000000013',repeat('f',64),'verified','drain-flag','drain-flag-wallet'),
  ('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000022','70000000-0000-4000-8000-000000000023',repeat('a',64),'verified','drain-abandon','drain-abandon-wallet');
INSERT INTO piggyvest_primary_card.settings VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','staging','fixture-business','baci_primary_card_authorizer','baci_primary_card_evidence','2099-01-01T00:00:00Z','https://example.test/wallet/card-return',true);
GRANT primary_card_authorizer TO baci_primary_card_authorizer;
GRANT primary_card_evidence TO baci_primary_card_evidence;
CREATE TABLE public.drain_fixture(label text PRIMARY KEY,scope jsonb,operation_id uuid);
GRANT SELECT, INSERT, UPDATE ON public.drain_fixture TO baci_primary_card_authorizer,baci_primary_card_evidence;
INSERT INTO public.drain_fixture(label,scope) VALUES
  ('read','{"environment":"staging","integrationId":"10000000-0000-4000-8000-000000000004","merchantId":"10000000-0000-4000-8000-000000000001","customerId":"70000000-0000-4000-8000-000000000002","userId":"70000000-0000-4000-8000-000000000003","businessId":"fixture-business","email":"drain-read@example.test","expiresAt":"2099-01-01T00:00:00Z","callbackUrl":"https://example.test/wallet/card-return"}'),
  ('flag','{"environment":"staging","integrationId":"10000000-0000-4000-8000-000000000004","merchantId":"10000000-0000-4000-8000-000000000001","customerId":"70000000-0000-4000-8000-000000000012","userId":"70000000-0000-4000-8000-000000000013","businessId":"fixture-business","email":"drain-flag@example.test","expiresAt":"2099-01-01T00:00:00Z","callbackUrl":"https://example.test/wallet/card-return"}'),
  ('abandon','{"environment":"staging","integrationId":"10000000-0000-4000-8000-000000000004","merchantId":"10000000-0000-4000-8000-000000000001","customerId":"70000000-0000-4000-8000-000000000022","userId":"70000000-0000-4000-8000-000000000023","businessId":"fixture-business","email":"drain-abandon@example.test","expiresAt":"2099-01-01T00:00:00Z","callbackUrl":"https://example.test/wallet/card-return"}');
-- Pre-expiry: reserve one operation per customer and move the abandonment
-- target to initializing (abandonment only accepts pre-ready states).
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE
  intent jsonb;
  claim jsonb;
BEGIN
  intent := piggyvest_primary_card.reserve((SELECT scope FROM public.drain_fixture WHERE label='read'),'{"idempotencyKey":"70000000-0000-4000-8000-000000000005","amountKobo":25000,"consent":{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}}');
  UPDATE public.drain_fixture SET operation_id=(intent->>'operationId')::uuid WHERE label='read';
  intent := piggyvest_primary_card.reserve((SELECT scope FROM public.drain_fixture WHERE label='flag'),'{"idempotencyKey":"70000000-0000-4000-8000-000000000015","amountKobo":25000,"consent":{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}}');
  UPDATE public.drain_fixture SET operation_id=(intent->>'operationId')::uuid WHERE label='flag';
  intent := piggyvest_primary_card.reserve((SELECT scope FROM public.drain_fixture WHERE label='abandon'),'{"idempotencyKey":"70000000-0000-4000-8000-000000000025","amountKobo":25000,"consent":{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}}');
  UPDATE public.drain_fixture SET operation_id=(intent->>'operationId')::uuid WHERE label='abandon';
  claim := piggyvest_primary_card.claim_initialization((SELECT scope FROM public.drain_fixture WHERE label='abandon'),(SELECT operation_id FROM public.drain_fixture WHERE label='abandon'));
  IF claim->>'outcome' <> 'claimed' THEN RAISE EXCEPTION 'abandon fixture not claimed'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
-- Expire the integration. The presented expiresAt keeps matching the
-- stored row (drain binds the known deadline; it does not waive it).
UPDATE piggyvest_primary_card.settings SET expires_at='2020-01-01T00:00:00Z'
  WHERE integration_id='10000000-0000-4000-8000-000000000004';
UPDATE public.drain_fixture SET scope=jsonb_set(scope,'{expiresAt}','"2020-01-01T00:00:00Z"');
-- Post-expiry: new reservations stop, existing operations drain.
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE
  scope jsonb := (SELECT scope FROM public.drain_fixture WHERE label='read');
  operation_id uuid := (SELECT fixture.operation_id FROM public.drain_fixture fixture WHERE fixture.label='read');
  claim jsonb;
  session jsonb;
BEGIN
  BEGIN
    PERFORM piggyvest_primary_card.reserve(scope,'{"idempotencyKey":"70000000-0000-4000-8000-000000000006","amountKobo":25000,"consent":{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}}');
    RAISE EXCEPTION 'post-expiry reservation accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF piggyvest_primary_card.read_operation(scope,operation_id)->>'status' <> 'reserved' THEN RAISE EXCEPTION 'post-expiry read blocked'; END IF;
  BEGIN
    PERFORM piggyvest_primary_card.read_operation(jsonb_set(scope,'{expiresAt}','"2099-01-01T00:00:00Z"'),operation_id);
    RAISE EXCEPTION 'drain accepted substituted deadline';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  claim := piggyvest_primary_card.claim_initialization(scope,operation_id);
  IF claim->>'outcome' <> 'claimed' THEN RAISE EXCEPTION 'post-expiry claim blocked'; END IF;
  session := jsonb_build_object('reference','pvb-first-primary-'||operation_id::text,'authorizationUrl','https://checkout.paystack.com/fixture123');
  IF NOT piggyvest_primary_card.record_initialization(scope,operation_id,(claim->>'token')::uuid,session) THEN RAISE EXCEPTION 'post-expiry session blocked'; END IF;
  IF piggyvest_primary_card.read_operation(scope,operation_id)->>'status' <> 'ready' THEN RAISE EXCEPTION 'drained session not ready'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_card_evidence;
DO $$ DECLARE
  scope jsonb := (SELECT scope FROM public.drain_fixture WHERE label='read');
  operation_id uuid := (SELECT fixture.operation_id FROM public.drain_fixture fixture WHERE fixture.label='read');
  collection jsonb := jsonb_build_object('reference','pvb-first-primary-'||operation_id::text,'amountKobo',25000,'domain','test','providerTransactionId','12345','token',NULL);
BEGIN
  IF NOT piggyvest_primary_card.record_collection(scope,operation_id,collection) THEN RAISE EXCEPTION 'post-expiry collection blocked'; END IF;
END $$;
DO $$ DECLARE
  scope jsonb := (SELECT scope FROM public.drain_fixture WHERE label='flag');
  operation_id uuid := (SELECT fixture.operation_id FROM public.drain_fixture fixture WHERE fixture.label='flag');
BEGIN
  IF NOT piggyvest_primary_card.flag_reconciliation(scope,operation_id) THEN RAISE EXCEPTION 'post-expiry flag blocked'; END IF;
END $$;
DO $$ DECLARE
  scope jsonb := (SELECT scope FROM public.drain_fixture WHERE label='abandon');
  operation_id uuid := (SELECT fixture.operation_id FROM public.drain_fixture fixture WHERE fixture.label='abandon');
BEGIN
  IF NOT piggyvest_primary_card.record_abandonment(scope,operation_id) THEN RAISE EXCEPTION 'post-expiry abandonment blocked'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT state FROM piggyvest_primary_card.operations WHERE id=(SELECT operation_id FROM public.drain_fixture WHERE label='read')) <> 'custody_pending' THEN RAISE EXCEPTION 'drained collection missed custody'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary_card.collections) <> 1 THEN RAISE EXCEPTION 'drained collection not stored'; END IF;
  IF (SELECT state FROM piggyvest_primary_card.operations WHERE id=(SELECT operation_id FROM public.drain_fixture WHERE label='flag')) <> 'reconciliation_required' THEN RAISE EXCEPTION 'drained flag missed reconciliation'; END IF;
  IF (SELECT state FROM piggyvest_primary_card.operations WHERE id=(SELECT operation_id FROM public.drain_fixture WHERE label='abandon')) <> 'abandoned' THEN RAISE EXCEPTION 'drained abandonment missed terminal'; END IF;
  IF (SELECT count(*) FROM piggyvest_primary_card.operations) <> 3 THEN RAISE EXCEPTION 'drain created operations'; END IF;
END $$;
