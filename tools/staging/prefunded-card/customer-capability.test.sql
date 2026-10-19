BEGIN;
SELECT set_config('test.customer_system',(SELECT system_identifier::text FROM pg_control_system()),true);
CREATE FUNCTION public.customer_capability_fixture(p_scope jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT prefunded_card.customer_capabilities(
    coalesce(p_scope->>'integration','d91d9e87-8e0d-44de-9b84-1e1d709633d2')::uuid,
    coalesce(p_scope->>'merchant','11111111-1111-4111-8111-111111111111')::uuid,
    coalesce(p_scope->>'customer','22222222-2222-4222-8222-222222222222')::uuid,
    coalesce(p_scope->>'goal','33333333-3333-4333-8333-333333333333')::uuid,
    coalesce(p_scope->>'actor','90000000-0000-4000-8000-000000000001')::uuid,
    coalesce(p_scope->>'business','business'),coalesce(p_scope->>'system',current_setting('test.customer_system')),
    jsonb_build_object('goalId',coalesce(p_scope->>'goal','33333333-3333-4333-8333-333333333333')))
$$;
CREATE FUNCTION public.assert_customer_capability(p_enabled boolean,p_methods integer,p_maximum bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
  result:=public.customer_capability_fixture();
  IF result->'enabled' IS DISTINCT FROM to_jsonb(p_enabled) OR result->'newCardEnabled' IS DISTINCT FROM 'false'::jsonb
    OR result->>'currency'<>'NGN'
    OR jsonb_array_length(result->'savedMethods')<>p_methods OR (SELECT count(*) FROM jsonb_object_keys(result))<>6
    OR result::text ~ '(AUTH_|CUS_|authorization|reserved_kobo|float)' THEN
    RAISE EXCEPTION 'unsafe customer capability'; END IF;
  IF coalesce(result->>'maximumAmountKobo','') !~ '^(0|[1-9][0-9]*)(\.0+)?$' THEN
    RAISE EXCEPTION 'unsafe customer capability'; END IF;
  IF (result->>'maximumAmountKobo')::numeric IS DISTINCT FROM p_maximum::numeric THEN
    RAISE EXCEPTION 'unsafe customer capability'; END IF;
  IF p_methods=1 AND result->'savedMethods' IS DISTINCT FROM
    '[{"id":"60000000-0000-4000-8000-000000000001","brand":"visa","last4":"4081"}]'::jsonb THEN
    RAISE EXCEPTION 'card summary mismatch'; END IF;
END $$;
UPDATE public.customer_savings_goals SET target_amount=1000;
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_capability(true,1,50000);
RESET SESSION AUTHORIZATION;
SAVEPOINT goal_remainder;
UPDATE public.customer_savings_goals SET target_amount=200;
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_capability(true,1,20000);
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT goal_remainder;
SAVEPOINT exhausted_treasury;
UPDATE prefunded_card.treasury_bindings SET reserved_kobo=verified_available_kobo;
DO $$ BEGIN
  IF NOT prefunded_card.treasury_reservation_ready('50000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'exhausted treasury fixture must remain reconciled and ready'; END IF;
END $$;
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_capability(false,1,0);
RESET SESSION AUTHORIZATION;
UPDATE prefunded_card.treasury_bindings SET reserved_kobo=verified_available_kobo-1;
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_capability(true,1,1);
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT exhausted_treasury;
SAVEPOINT stale_treasury_snapshot;
ALTER TABLE prefunded_card.treasury_snapshots DISABLE TRIGGER prefunded_treasury_snapshot_guard;
UPDATE prefunded_card.treasury_snapshots SET observed_at=clock_timestamp()-interval '16 minutes'
  WHERE treasury_binding_id='50000000-0000-4000-8000-000000000001';
ALTER TABLE prefunded_card.treasury_snapshots ENABLE TRIGGER prefunded_treasury_snapshot_guard;
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_capability(false,0,0);
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT stale_treasury_snapshot;
SAVEPOINT consumed_treasury;
UPDATE prefunded_card.treasury_bindings SET consumed_kobo=12000;
SET SESSION AUTHORIZATION treasury_verifier;
SELECT prefunded_card.record_treasury_snapshot(
  '50000000-0000-4000-8000-000000000001','consumed-capability-snapshot',2,
  clock_timestamp(),38000);
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_capability(true,1,38000);
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT consumed_treasury;
SET SESSION AUTHORIZATION projection_worker;
DO $$ DECLARE scope jsonb; BEGIN
  FOREACH scope IN ARRAY ARRAY[
    '{"system":"1"}'::jsonb,'{"business":"wrong"}'::jsonb,
    '{"actor":"90000000-0000-4000-8000-000000000099"}'::jsonb,
    '{"merchant":"11111111-1111-4111-8111-111111111199"}'::jsonb,
    '{"customer":"22222222-2222-4222-8222-222222222299"}'::jsonb,
    '{"goal":"33333333-3333-4333-8333-333333333399"}'::jsonb,
    '{"integration":"d91d9e87-8e0d-44de-9b84-1e1d709633d3"}'::jsonb
  ] LOOP
    BEGIN
      PERFORM public.customer_capability_fixture(scope);
      RAISE EXCEPTION 'foreign capability scope allowed';
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM<>'prefunded customer capability unavailable' THEN RAISE EXCEPTION 'unredacted capability error'; END IF;
    END;
  END LOOP;
END $$;
RESET SESSION AUTHORIZATION;
INSERT INTO public.customer_saved_payment_methods(id,merchant_id,customer_id,provider,reusable,is_active,disabled_at,
  authorization_code,authorization_signature,authorization_data,provider_customer_email,brand,last4)
SELECT '60000000-0000-4000-8000-000000000099',merchant_id,customer_id,provider,reusable,is_active,disabled_at,
  authorization_code,authorization_signature,authorization_data,provider_customer_email,brand,last4
  FROM public.customer_saved_payment_methods WHERE id='60000000-0000-4000-8000-000000000001';
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_capability(true,1,50000);
RESET SESSION AUTHORIZATION;
UPDATE public.customer_saved_payment_methods SET is_active=false WHERE id='60000000-0000-4000-8000-000000000001';
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_capability(false,0,50000);
RESET SESSION AUTHORIZATION;
UPDATE public.customer_saved_payment_methods SET is_active=true,reusable=false WHERE id='60000000-0000-4000-8000-000000000001';
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_capability(false,0,50000);
RESET SESSION AUTHORIZATION;
UPDATE public.customer_saved_payment_methods SET reusable=true,disabled_at=clock_timestamp() WHERE id='60000000-0000-4000-8000-000000000001';
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_capability(false,0,50000);
RESET SESSION AUTHORIZATION;
UPDATE public.customer_saved_payment_methods SET disabled_at=NULL,authorization_code='AUTH_changed' WHERE id='60000000-0000-4000-8000-000000000001';
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_capability(false,0,50000);
RESET SESSION AUTHORIZATION;
INSERT INTO public.customers(id,merchant_id,user_id) VALUES('22222222-2222-4222-8222-222222222299',
  '11111111-1111-4111-8111-111111111111','90000000-0000-4000-8000-000000000099');
UPDATE public.customer_saved_payment_methods SET authorization_code='AUTH_fixture',customer_id='22222222-2222-4222-8222-222222222299'
  WHERE id='60000000-0000-4000-8000-000000000001';
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_capability(false,0,50000);
RESET SESSION AUTHORIZATION;
UPDATE public.customer_saved_payment_methods SET customer_id='22222222-2222-4222-8222-222222222222',last4='secret'
  WHERE id='60000000-0000-4000-8000-000000000001';
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_capability(false,0,50000);
RESET SESSION AUTHORIZATION;
UPDATE public.customer_saved_payment_methods SET last4='4081' WHERE id='60000000-0000-4000-8000-000000000001';
UPDATE public.customer_savings_goals SET goal_kind='canonical_local';
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_capability(false,0,0);
DO $$ BEGIN
  BEGIN
    PERFORM prefunded_card.customer_request('d91d9e87-8e0d-44de-9b84-1e1d709633d2',
      '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333','90000000-0000-4000-8000-000000000001',
      'business',current_setting('test.customer_system'),'{"goalId":"33333333-3333-4333-8333-333333333333",
        "savedMethodId":"60000000-0000-4000-8000-000000000001","amountKobo":100,
        "idempotencyKey":"80000000-0000-4000-8000-000000000099","consent":{"version":"prefunded-card-v1","oneTimeCharge":true}}');
    RAISE EXCEPTION 'canonical local card reservation allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM<>'prefunded customer request unavailable' THEN RAISE EXCEPTION 'unredacted customer error'; END IF;
  END;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.customer_savings_goals SET goal_kind='legacy';
SET SESSION AUTHORIZATION projection_worker;
SELECT prefunded_card.customer_request('d91d9e87-8e0d-44de-9b84-1e1d709633d2',
  '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333','90000000-0000-4000-8000-000000000001',
  'business',current_setting('test.customer_system'),'{"goalId":"33333333-3333-4333-8333-333333333333",
    "savedMethodId":"60000000-0000-4000-8000-000000000001","amountKobo":100,
    "idempotencyKey":"80000000-0000-4000-8000-000000000099","consent":{"version":"prefunded-card-v1","oneTimeCharge":true}}');
SELECT public.assert_customer_capability(true,1,49900);
RESET SESSION AUTHORIZATION;
UPDATE public.customer_savings_goals SET target_amount=1;
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_capability(false,1,0);
RESET SESSION AUTHORIZATION;
UPDATE public.customer_savings_goals SET target_amount=1000;
DO $$ BEGIN
  IF (SELECT count(*) FROM prefunded_card.operations)<>1 OR (SELECT count(*) FROM prefunded_card.customer_consents)<>1
    OR (SELECT reserved_kobo FROM prefunded_card.treasury_bindings)<>100
    OR EXISTS(SELECT 1 FROM piggyvest_savings_ledger.operations)
    OR EXISTS(SELECT 1 FROM public.customer_savings_contributions) THEN
    RAISE EXCEPTION 'capability reads modified economic state'; END IF;
END $$;
UPDATE public.customer_savings_goals SET status='completed';
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_capability(false,0,0);
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF has_function_privilege('anon','prefunded_card.customer_capabilities(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','prefunded_card.customer_capabilities(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'capability public grant leaked'; END IF;
END $$;
ROLLBACK;
