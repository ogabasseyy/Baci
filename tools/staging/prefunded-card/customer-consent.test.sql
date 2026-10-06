BEGIN;
SELECT set_config('test.customer_system',(SELECT system_identifier::text FROM pg_control_system()),true);
CREATE FUNCTION public.customer_consent_input() RETURNS jsonb LANGUAGE sql AS $$
  SELECT '{"goalId":"33333333-3333-4333-8333-333333333333","savedMethodId":"60000000-0000-4000-8000-000000000001",
    "idempotencyKey":"80000000-0000-4000-8000-000000000091","amountKobo":100,
    "consent":{"version":"prefunded-card-v1","oneTimeCharge":true}}'::jsonb
$$;
CREATE FUNCTION public.customer_consent_request(p_input jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT prefunded_card.customer_request('d91d9e87-8e0d-44de-9b84-1e1d709633d2',
    '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333','90000000-0000-4000-8000-000000000001',
    'business',current_setting('test.customer_system'),p_input)
$$;
CREATE FUNCTION public.assert_customer_consent_refused(p_input jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.customer_consent_request(p_input);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'prefunded customer request unavailable' THEN RAISE EXCEPTION 'unredacted customer error'; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'expected customer consent refusal';
END $$;
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_consent_refused(public.customer_consent_input()-'consent');
SELECT public.assert_customer_consent_refused(public.customer_consent_input()||'{"consent":null}');
SELECT public.assert_customer_consent_refused(public.customer_consent_input()||
  '{"consent":{"version":"prefunded-card-v1","oneTimeCharge":false}}');
SELECT public.assert_customer_consent_refused(public.customer_consent_input()||
  '{"consent":{"version":"prefunded-card-v1","oneTimeCharge":"true"}}');
SELECT public.assert_customer_consent_refused(public.customer_consent_input()||
  '{"consent":{"version":"other","oneTimeCharge":true}}');
SELECT public.assert_customer_consent_refused(public.customer_consent_input()||
  '{"consent":{"version":"prefunded-card-v1","oneTimeCharge":true,"actorId":"spoofed"}}');
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM prefunded_card.operations) OR EXISTS(SELECT 1 FROM prefunded_card.customer_consents)
    OR EXISTS(SELECT 1 FROM prefunded_card.dispatch_queue)
    OR (SELECT reserved_kobo FROM prefunded_card.treasury_bindings)<>0 THEN
    RAISE EXCEPTION 'invalid consent reserved or enqueued a charge'; END IF;
END $$;
SET SESSION AUTHORIZATION projection_worker;
SELECT public.customer_consent_request(public.customer_consent_input());
SELECT public.customer_consent_request(public.customer_consent_input());
SELECT public.assert_customer_consent_refused(public.customer_consent_input()||'{"amountKobo":101}');
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT count(*) FROM prefunded_card.customer_consents)<>1
    OR (SELECT count(*) FROM prefunded_card.operations)<>1
    OR (SELECT count(*) FROM prefunded_card.dispatch_queue)<>1
    OR (SELECT reserved_kobo FROM prefunded_card.treasury_bindings)<>100 THEN
    RAISE EXCEPTION 'consent and reservation did not remain idempotent'; END IF;
  IF NOT EXISTS(SELECT 1 FROM prefunded_card.customer_consents consent
    JOIN prefunded_card.operations operation ON operation.id=consent.operation_id
    WHERE consent.actor_id='90000000-0000-4000-8000-000000000001' AND consent.consent_version='prefunded-card-v1'
      AND consent.one_time_charge AND consent.request_fingerprint=operation.request_fingerprint
      AND consent.authorized_login='projection_worker' AND consent.database_name=current_database()
      AND consent.system_identifier=current_setting('test.customer_system') AND consent.accepted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'consent is not bound to authenticated operation scope'; END IF;
  BEGIN
    UPDATE prefunded_card.customer_consents SET actor_id='90000000-0000-4000-8000-000000000099';
    RAISE EXCEPTION 'consent update allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM prefunded_card.customer_consents;
    RAISE EXCEPTION 'consent delete allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    TRUNCATE prefunded_card.customer_consents;
    RAISE EXCEPTION 'consent truncate allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
CREATE FUNCTION public.refuse_customer_consent_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'private provider credential fixture'; END $$;
CREATE TRIGGER refuse_consent_fixture BEFORE INSERT ON prefunded_card.customer_consents
  FOR EACH ROW EXECUTE FUNCTION public.refuse_customer_consent_fixture();
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_consent_refused(public.customer_consent_input()||
  '{"idempotencyKey":"80000000-0000-4000-8000-000000000092"}');
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT count(*) FROM prefunded_card.operations)<>1 OR (SELECT count(*) FROM prefunded_card.customer_consents)<>1
    OR (SELECT count(*) FROM prefunded_card.dispatch_queue)<>1
    OR (SELECT reserved_kobo FROM prefunded_card.treasury_bindings)<>100
    OR EXISTS(SELECT 1 FROM piggyvest_savings_ledger.operations) THEN
    RAISE EXCEPTION 'failed consent audit did not roll back the reservation atomically'; END IF;
  IF has_table_privilege('projection_worker','prefunded_card.customer_consents','INSERT')
    OR has_function_privilege('projection_worker','prefunded_card.record_customer_consent(uuid,uuid,jsonb,text)','EXECUTE')
    OR has_table_privilege('authenticated','prefunded_card.customer_consents','SELECT') THEN
    RAISE EXCEPTION 'consent audit privilege leaked'; END IF;
END $$;
DROP TRIGGER refuse_consent_fixture ON prefunded_card.customer_consents;
SELECT set_config('test.unconsented_command',(
  SELECT jsonb_build_object('operationId','70000000-0000-4000-8000-000000000093',
    'integrationId',integration_id,'merchantId',merchant_id,'customerId',customer_id,'goalId',goal_id,
    'treasuryBindingId',treasury_binding_id,'requestFingerprint',request_fingerprint,
    'idempotencyKey',encode(sha256(convert_to(jsonb_build_array(integration_id,merchant_id,customer_id,goal_id,
      '80000000-0000-4000-8000-000000000093'::uuid)::text,'UTF8')),'hex'),
    'savedMethodId',saved_method_id,'amountKobo',amount_kobo,'feeAllowanceKobo',0,'currency','NGN',
    'collectionReference','unconsented-collection','transferReference','unconsented-transfer',
    'destinationWalletId',destination_wallet_id,'destinationCustomerId',destination_customer_id)::text
  FROM prefunded_card.operations
),true);
GRANT EXECUTE ON FUNCTION prefunded_card.reserve(jsonb) TO projection_worker;
SET SESSION AUTHORIZATION projection_worker;
SELECT prefunded_card.reserve(current_setting('test.unconsented_command')::jsonb);
SELECT public.assert_customer_consent_refused(public.customer_consent_input()||
  '{"idempotencyKey":"80000000-0000-4000-8000-000000000093"}');
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM prefunded_card.customer_consents WHERE operation_id='70000000-0000-4000-8000-000000000093')
    OR (SELECT count(*) FROM prefunded_card.customer_consents)<>1 THEN
    RAISE EXCEPTION 'retry fabricated a historical consent audit'; END IF;
END $$;
SAVEPOINT mismatched_consent;
INSERT INTO prefunded_card.customer_consents(operation_id,actor_id,consent_version,one_time_charge,
  request_fingerprint,authorized_login,system_identifier,database_name)
SELECT id,'90000000-0000-4000-8000-000000000099','prefunded-card-v1',true,
  request_fingerprint,'projection_worker',current_setting('test.customer_system'),current_database()
  FROM prefunded_card.operations WHERE id='70000000-0000-4000-8000-000000000093';
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_consent_refused(public.customer_consent_input()||
  '{"idempotencyKey":"80000000-0000-4000-8000-000000000093"}');
RESET SESSION AUTHORIZATION;
ROLLBACK TO SAVEPOINT mismatched_consent;
INSERT INTO prefunded_card.customer_consents(operation_id,actor_id,consent_version,one_time_charge,
  request_fingerprint,authorized_login,system_identifier,database_name)
SELECT id,'90000000-0000-4000-8000-000000000001','prefunded-card-v1',true,
  repeat('0',64),'projection_worker',current_setting('test.customer_system'),current_database()
  FROM prefunded_card.operations WHERE id='70000000-0000-4000-8000-000000000093';
SET SESSION AUTHORIZATION projection_worker;
SELECT public.assert_customer_consent_refused(public.customer_consent_input()||
  '{"idempotencyKey":"80000000-0000-4000-8000-000000000093"}');
RESET SESSION AUTHORIZATION;
ROLLBACK;
