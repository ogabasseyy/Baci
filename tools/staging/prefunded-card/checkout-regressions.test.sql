BEGIN;

CREATE SCHEMA IF NOT EXISTS prefunded_first_card_checkout_test;
CREATE OR REPLACE FUNCTION prefunded_first_card_checkout_test.assert(p_condition boolean,p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%',p_message; END IF;
END $$;

CREATE OR REPLACE FUNCTION prefunded_first_card_checkout_test.assert_denied(p_statement text,p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_statement;
  RAISE EXCEPTION '%',p_message;
EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE '22023' THEN NULL;
END $$;

SELECT prefunded_first_card_checkout_test.assert(
  to_regprocedure('prefunded_card.checkout_capability(jsonb,uuid,uuid,uuid,bigint)') IS NOT NULL
  AND to_regprocedure('prefunded_card.checkout_reserve(jsonb,jsonb)') IS NOT NULL
  AND to_regprocedure('prefunded_card.checkout_read(jsonb,jsonb)') IS NOT NULL
  AND to_regprocedure('prefunded_card.checkout_claim_initialization(jsonb,jsonb)') IS NOT NULL
  AND to_regprocedure('prefunded_card.checkout_complete_initialization(jsonb,jsonb,jsonb,jsonb)') IS NOT NULL
  AND to_regprocedure('prefunded_card.checkout_mark_initialization_uncertain(jsonb,jsonb,jsonb)') IS NOT NULL
  AND to_regprocedure('prefunded_card.checkout_promote_collection(jsonb,jsonb,jsonb)') IS NOT NULL
  AND to_regprocedure('prefunded_card.checkout_flag_reconciliation(jsonb,jsonb)') IS NOT NULL,
  'first-card checkout RPC catalog is incomplete'
);

SELECT prefunded_first_card_checkout_test.assert(
  NOT has_function_privilege('anon','prefunded_card.checkout_capability(jsonb,uuid,uuid,uuid,bigint)','EXECUTE')
  AND NOT has_function_privilege('authenticated','prefunded_card.checkout_capability(jsonb,uuid,uuid,uuid,bigint)','EXECUTE')
  AND NOT has_function_privilege('service_role','prefunded_card.checkout_capability(jsonb,uuid,uuid,uuid,bigint)','EXECUTE')
  AND has_function_privilege('prefunded_treasury_operator','prefunded_card.checkout_capability(jsonb,uuid,uuid,uuid,bigint)','EXECUTE')
  AND NOT has_function_privilege('prefunded_authorizer','prefunded_card.checkout_capability(jsonb,uuid,uuid,uuid,bigint)','EXECUTE')
  AND NOT has_function_privilege('anon','prefunded_card.checkout_reserve(jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege('authenticated','prefunded_card.checkout_reserve(jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege('service_role','prefunded_card.checkout_reserve(jsonb,jsonb)','EXECUTE')
  AND has_function_privilege('prefunded_treasury_operator','prefunded_card.checkout_reserve(jsonb,jsonb)','EXECUTE')
  AND has_function_privilege('prefunded_treasury_operator','prefunded_card.checkout_read(jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege('prefunded_treasury_operator','prefunded_card.checkout_promote_collection(jsonb,jsonb,jsonb)','EXECUTE')
  AND has_function_privilege('prefunded_authorizer','prefunded_card.checkout_promote_collection(jsonb,jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege('prefunded_authorizer','prefunded_card.checkout_read(jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege('prefunded_authorizer','prefunded_card.checkout_reserve(jsonb,jsonb)','EXECUTE'),
  'first-card checkout roles are not disjoint'
);

SELECT prefunded_first_card_checkout_test.assert(
  NOT EXISTS (
    SELECT 1 FROM prefunded_card.checkout_intents intent
    LEFT JOIN prefunded_card.operations operation ON operation.id=intent.operation_id
    WHERE operation.id IS NULL OR operation.id<>intent.id OR operation.collection_reference<>intent.reference
      OR operation.transfer_reference<>intent.transfer_reference OR operation.saved_method_id<>intent.prepared_saved_method_id
      OR operation.collection_status NOT IN ('pending','verified_success')
  ),
  'first-card checkout must never enter generic collection dispatch'
);

SELECT prefunded_first_card_checkout_test.assert(
  NOT EXISTS (
    SELECT 1 FROM prefunded_card.checkout_intents intent
    JOIN public.customer_saved_payment_methods method ON method.id=intent.prepared_saved_method_id
    JOIN prefunded_card.operations operation ON operation.id=intent.operation_id
    WHERE operation.collection_status<>'verified_success'
  ),
  'first-card checkout created a public method before verified collection'
);

SELECT prefunded_first_card_checkout_test.assert(
  NOT EXISTS (
    SELECT 1 FROM prefunded_card.checkout_intents intent
    JOIN prefunded_card.operations operation ON operation.id=intent.operation_id
    JOIN prefunded_card.treasury_bindings treasury ON treasury.id=operation.treasury_binding_id
    WHERE operation.collection_status='pending'
      AND treasury.reserved_kobo<operation.amount_kobo
  ),
  'pending first-card checkout lost its reserved treasury capacity'
);

SELECT prefunded_first_card_checkout_test.assert_denied(
  $sql$SELECT prefunded_card.checkout_validate_scope(jsonb_build_object(
    'deployment','null'::jsonb,'integrationId','d91d9e87-8e0d-44de-9b84-1e1d709633d2',
    'merchantId','11111111-1111-4111-8111-111111111111','treasuryBindingId','50000000-0000-4000-8000-000000000001',
    'businessId','business','systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
    'expiresAt','2026-09-29T15:59:10Z'),false)$sql$,
  'scope accepted JSON null or non-string primitives'
);

SELECT prefunded_first_card_checkout_test.assert_denied(
  $sql$SELECT prefunded_card.checkout_validate_selection(jsonb_build_object(
    'intentId','80000000-0000-4000-8000-000000000001','customerId','null'::jsonb,'actorId','90000000-0000-4000-8000-000000000001',
    'goalId','33333333-3333-4333-8333-333333333333'))$sql$,
  'selection accepted JSON null or non-string primitives'
);

SELECT prefunded_first_card_checkout_test.assert_denied(
  $sql$SELECT prefunded_card.checkout_validate_request(jsonb_build_object(
    'customerId','null'::jsonb,'actorId','90000000-0000-4000-8000-000000000001',
    'goalId','33333333-3333-4333-8333-333333333333','amountKobo',10000,
    'idempotencyKey','80000000-0000-4000-8000-000000000001',
    'consent','{"version":"prefunded-first-card-v1","oneTimeCharge":true,"saveCard":true}'::jsonb))$sql$,
  'request accepted JSON null or non-number amount'
);

DO $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE; claim jsonb; collection jsonb; field_name text;
BEGIN
  SELECT * INTO intent FROM prefunded_card.checkout_intents ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'first-card checkout fixture intent missing'; END IF;
  intent.phase:='initializing'; intent.initialization_token:='80000000-0000-4000-8000-000000000001';
  intent.initialization_fence:=1; intent.initialization_lease_expires_at:=clock_timestamp()+interval '1 minute';
  claim:=jsonb_build_object('outcome','claimed','intent',prefunded_card.checkout_intent_json(intent),
    'token',intent.initialization_token,'fence',intent.initialization_fence,
    'leaseExpiresAt',prefunded_card.checkout_utc_iso(intent.initialization_lease_expires_at));
  PERFORM prefunded_card.checkout_validate_initialization_claim(intent,claim,false);
  FOREACH field_name IN ARRAY ARRAY['outcome','intent','token','fence','leaseExpiresAt'] LOOP
    BEGIN
      PERFORM prefunded_card.checkout_validate_initialization_claim(intent,jsonb_set(claim,ARRAY[field_name],'null'::jsonb),false);
      RAISE EXCEPTION 'claim accepted JSON null field %',field_name;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
  END LOOP;
  PERFORM prefunded_card.checkout_validate_session(intent,jsonb_build_object('reference',intent.reference,
    'authorizationUrl','https://checkout.paystack.com/firstCardTest'));
  BEGIN
    PERFORM prefunded_card.checkout_validate_session(intent,jsonb_build_object('reference','null'::jsonb,
      'authorizationUrl','https://checkout.paystack.com/firstCardTest'));
    RAISE EXCEPTION 'session accepted JSON null reference';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  collection:=jsonb_build_object('intentId',intent.id::text,'reference',intent.reference,'providerTransactionId','1',
    'amountKobo',intent.amount_kobo,'currency','NGN','domain','test','authorization',jsonb_build_object(
      'authorizationCode','AUTH_test','signature','signature','customerCode','CUS_customer',
      'email',intent.email,'reusable',true,'brand','visa','last4','4081','expiryMonth','12','expiryYear','2030'));
  PERFORM prefunded_card.checkout_validate_collection(intent,collection);
  FOREACH field_name IN ARRAY ARRAY['intentId','reference','providerTransactionId','amountKobo','currency','domain','authorization'] LOOP
    BEGIN
      PERFORM prefunded_card.checkout_validate_collection(intent,jsonb_set(collection,ARRAY[field_name],'null'::jsonb));
      RAISE EXCEPTION 'collection accepted JSON null field %',field_name;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
  END LOOP;
  FOREACH field_name IN ARRAY ARRAY['authorizationCode','signature','customerCode','email','reusable','brand','last4','expiryMonth','expiryYear'] LOOP
    BEGIN
      PERFORM prefunded_card.checkout_validate_collection(intent,jsonb_set(collection,ARRAY['authorization',field_name],'null'::jsonb));
      RAISE EXCEPTION 'authorization accepted JSON null field %',field_name;
    EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
    END;
  END LOOP;
END $$;

SELECT prefunded_first_card_checkout_test.assert(
  pg_get_functiondef('prefunded_card.checkout_promote_collection(jsonb,jsonb,jsonb)'::regprocedure)
    ~ 'EXCEPTION WHEN unique_violation THEN[[:space:]]+PERFORM prefunded_card.checkout_validate_scope\(p_scope,true\);',
  'promotion conflict handler lost its post-wait deadline guard'
);

ALTER TABLE prefunded_card.checkout_intents DISABLE TRIGGER prefunded_first_card_checkout_intent_guard;
ALTER TABLE prefunded_card.operations DISABLE TRIGGER prefunded_first_card_collection_transition_guard;
DO $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE;
BEGIN
  SELECT * INTO intent FROM prefunded_card.checkout_intents
  WHERE verified_collection IS NOT NULL ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'first-card promotion replay fixture missing'; END IF;
  UPDATE prefunded_card.operations SET collection_status='pending',collection_provider_transaction_id=NULL
    WHERE id=intent.operation_id;
  UPDATE prefunded_card.checkout_intents SET phase='reconciliation_required',verified_collection=NULL,
    reconciliation_flagged_at='2026-09-20T12:00:00Z',reconciliation_flagged_by='regression-fixture'
    WHERE id=intent.id;
END $$;
ALTER TABLE prefunded_card.checkout_intents ENABLE TRIGGER prefunded_first_card_checkout_intent_guard;
ALTER TABLE prefunded_card.operations ENABLE TRIGGER prefunded_first_card_collection_transition_guard;

CREATE TEMP TABLE promotion_replay_fixture AS
SELECT jsonb_build_object('deployment',intent.deployment,'integrationId',intent.integration_id,
    'merchantId',intent.merchant_id,'treasuryBindingId',intent.treasury_binding_id,
    'businessId',intent.business_id,'systemIdentifier',intent.system_identifier,
    'expiresAt','2026-09-29T15:59:10Z') AS scope,
  jsonb_build_object('intentId',intent.id,'customerId',intent.customer_id,
    'actorId',intent.actor_id,'goalId',intent.goal_id) AS selection,
  method_collection.collection AS collection
FROM prefunded_card.checkout_intents intent
CROSS JOIN LATERAL (
  SELECT jsonb_build_object('intentId',intent.id,'reference',intent.reference,
    'providerTransactionId','900001','amountKobo',intent.amount_kobo,'currency','NGN','domain','test',
    'authorization',jsonb_build_object('authorizationCode',method.authorization_code,
      'signature',method.authorization_signature,'customerCode','CUS_checkout_replay',
      'email',intent.email,'reusable',true,'brand','visa','last4','4081','expiryMonth','12','expiryYear','2030')) AS collection
  FROM public.customer_saved_payment_methods method
  WHERE method.id=intent.prepared_saved_method_id
) method_collection
WHERE intent.phase='reconciliation_required'
  AND EXISTS (SELECT 1 FROM public.customer_saved_payment_methods method
    WHERE method.customer_id=intent.customer_id AND method.provider='paystack'
      AND method.authorization_signature=method_collection.collection#>>'{authorization,signature}');
GRANT SELECT ON promotion_replay_fixture TO prefunded_authorizer;

SET SESSION AUTHORIZATION prefunded_authorizer;
DO $$
DECLARE fixture record; first_snapshot jsonb; duplicate_snapshot jsonb;
BEGIN
  SELECT * INTO STRICT fixture FROM promotion_replay_fixture;
  first_snapshot:=prefunded_card.checkout_promote_collection(fixture.scope,fixture.selection,fixture.collection);
  duplicate_snapshot:=prefunded_card.checkout_promote_collection(fixture.scope,fixture.selection,fixture.collection);
  IF first_snapshot IS DISTINCT FROM duplicate_snapshot OR first_snapshot->>'phase' IS DISTINCT FROM 'reconciliation_required' THEN
    RAISE EXCEPTION 'duplicate checkout promotion changed its reconciliation snapshot';
  END IF;
END $$;
RESET SESSION AUTHORIZATION;
SELECT prefunded_first_card_checkout_test.assert(
  (SELECT intent.reconciliation_flagged_at='2026-09-20T12:00:00Z'::timestamptz
    FROM prefunded_card.checkout_intents intent
    JOIN promotion_replay_fixture fixture ON intent.id=(fixture.selection->>'intentId')::uuid),
  'duplicate checkout promotion refreshed its reconciliation timestamp'
);

ROLLBACK;
