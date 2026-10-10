\ir ../../../../../supabase/migrations/20261008091300_primary_card_treasury_release.sql
-- Mirror production version order: the checkout chain already applies the
-- stale-init superset, so re-apply it after the treasury base to keep the
-- chain's terminal function versions identical to a migrated database.
\ir ../../../../../supabase/migrations/20261008091500_primary_card_stale_init_reentry.sql
BEGIN;
INSERT INTO prefunded_card.treasury_snapshots VALUES('90000000-0000-4000-8000-000000000002','stale-local',2,now()-interval '16 minutes',980000,'fixture_verifier',now());
SET SESSION AUTHORIZATION baci_primary_card_transfer;
DO $$ DECLARE fixture record; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='third@example.test';
 BEGIN
  PERFORM piggyvest_primary_card.claim_transfer((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id);
  RAISE EXCEPTION 'stale treasury dispatch accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM piggyvest_primary_card.transfer_outbox WHERE state<>'ready') THEN RAISE EXCEPTION 'stale dispatch consumed claim'; END IF;
END $$;
ROLLBACK;
BEGIN;
UPDATE prefunded_card.treasury_bindings SET enabled=false;
SET SESSION AUTHORIZATION baci_primary_card_transfer;
DO $$ DECLARE fixture record; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='third@example.test';
 BEGIN
  PERFORM piggyvest_primary_card.claim_transfer((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id);
  RAISE EXCEPTION 'suspended treasury dispatch accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
ROLLBACK;
BEGIN;
INSERT INTO public.customers VALUES('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003','fifth@example.test');
INSERT INTO piggyvest_primary.onboarding_intents(integration_id,merchant_id,customer_id,user_id,request_fingerprint,state,provider_customer_id,provider_wallet_id)
VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',repeat('f',64),'verified','fifth','fifth-wallet');
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE scope jsonb := (SELECT scope FROM public.custody_fixture WHERE label='third@example.test'); BEGIN
 scope := scope||'{"customerId":"50000000-0000-4000-8000-000000000002","userId":"50000000-0000-4000-8000-000000000003","email":"fifth@example.test"}';
 BEGIN
  PERFORM piggyvest_primary_card.reserve(scope,'{"idempotencyKey":"50000000-0000-4000-8000-000000000005","amountKobo":25000,"consent":{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}}');
  RAISE EXCEPTION 'daily/reserved cap bypassed';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF (SELECT reserved_kobo FROM prefunded_card.treasury_bindings)<>60000 THEN RAISE EXCEPTION 'failed reservation leaked capacity'; END IF;
END $$;
ROLLBACK;
BEGIN;
UPDATE piggyvest_primary_card.operations SET state='ready' WHERE customer_id='40000000-0000-4000-8000-000000000002';
SET SESSION AUTHORIZATION baci_primary_card_evidence;
DO $$ DECLARE fixture record; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='fourth@example.test';
 IF NOT piggyvest_primary_card.record_abandonment(fixture.scope,fixture.operation_id) THEN RAISE EXCEPTION 'ready checkout not abandoned'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF (SELECT state FROM piggyvest_primary_card.reservations WHERE operation_id=(SELECT fixture.operation_id FROM public.custody_fixture fixture WHERE fixture.label='fourth@example.test'))<>'released' THEN RAISE EXCEPTION 'abandonment kept reservation'; END IF;
 IF (SELECT reserved_kobo FROM prefunded_card.treasury_bindings)<>35000 THEN RAISE EXCEPTION 'abandonment kept treasury capacity'; END IF;
END $$;
ROLLBACK;
BEGIN;
UPDATE piggyvest_primary_card.operations SET state='ready' WHERE customer_id='40000000-0000-4000-8000-000000000002';
SET SESSION AUTHORIZATION baci_primary_card_evidence;
DO $$ DECLARE fixture record; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='fourth@example.test';
 IF NOT piggyvest_primary_card.flag_reconciliation(fixture.scope,fixture.operation_id) THEN RAISE EXCEPTION 'ready checkout not flagged'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF (SELECT state FROM piggyvest_primary_card.reservations WHERE operation_id=(SELECT fixture.operation_id FROM public.custody_fixture fixture WHERE fixture.label='fourth@example.test'))<>'released' THEN RAISE EXCEPTION 'flag kept reservation'; END IF;
 IF (SELECT reserved_kobo FROM prefunded_card.treasury_bindings)<>35000 THEN RAISE EXCEPTION 'flag kept treasury capacity'; END IF;
END $$;
ROLLBACK;
