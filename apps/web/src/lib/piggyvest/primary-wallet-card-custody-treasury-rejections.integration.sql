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
  PERFORM piggyvest_primary_card.reserve(scope,'{"idempotencyKey":"50000000-0000-4000-8000-000000000005","amountKobo":1,"consent":{"version":"primary-wallet-card-v1","oneTimeCharge":true,"saveCard":false}}');
  RAISE EXCEPTION 'daily/reserved cap bypassed';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF (SELECT reserved_kobo FROM prefunded_card.treasury_bindings)<>60000 THEN RAISE EXCEPTION 'failed reservation leaked capacity'; END IF;
END $$;
ROLLBACK;
