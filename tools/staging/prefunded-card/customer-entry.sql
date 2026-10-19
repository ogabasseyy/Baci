BEGIN;
CREATE FUNCTION prefunded_card.customer_result(p_operation uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('operationId',id,'goalId',goal_id,'amountKobo',amount_kobo,'currency',currency,
    'status',CASE WHEN collection_status IN ('reversed','action_required') OR transfer_status='verified_failed'
      OR projection_status='reconciliation_required' THEN 'reconciliation_required'
      WHEN projection_status='applied' THEN 'completed'
      WHEN collection_status='verified_failed' THEN 'collection_failed' ELSE 'pending' END)
  FROM prefunded_card.operations WHERE id=p_operation
$$;

CREATE FUNCTION prefunded_card.customer_command(p_integration uuid,p_merchant uuid,p_customer uuid,p_goal uuid,
  p_actor uuid,p_business text,p_system text,p_input jsonb,p_create boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE treasury prefunded_card.treasury_bindings%ROWTYPE; mapped record;
DECLARE existing prefunded_card.operations%ROWTYPE; operation_id uuid; key_hash text; fingerprint text;
DECLARE command jsonb; count_bindings integer; authorization_proof jsonb;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed'
    OR p_system IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system()) THEN
    RAISE EXCEPTION 'prefunded customer identity refused' USING ERRCODE='42501';
  END IF;
  IF p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR p_create IS NULL
    OR p_input->>'goalId' IS DISTINCT FROM p_goal::text
    OR (p_input->>'idempotencyKey')::uuid IS NULL
    OR (SELECT count(*) FROM jsonb_object_keys(p_input))<>(CASE WHEN p_create THEN 5 ELSE 2 END)
    OR NOT p_input ?& (CASE WHEN p_create THEN ARRAY['goalId','idempotencyKey','amountKobo','savedMethodId','consent']
      ELSE ARRAY['goalId','idempotencyKey'] END) THEN
    RAISE EXCEPTION 'prefunded customer input refused' USING ERRCODE='22023';
  END IF;
  IF p_create AND (p_input->'consent' IS DISTINCT FROM '{"version":"prefunded-card-v1","oneTimeCharge":true}'::jsonb
    OR jsonb_typeof(p_input->'amountKobo') IS DISTINCT FROM 'number'
    OR (p_input->>'amountKobo') !~ '^[1-9][0-9]{0,15}$'
    OR (p_input->>'amountKobo')::numeric>9007199254740991
    OR (p_input->>'savedMethodId')::uuid IS NULL) THEN
    RAISE EXCEPTION 'prefunded customer amount refused' USING ERRCODE='22023';
  END IF;
  SELECT count(*) INTO count_bindings FROM prefunded_card.treasury_bindings
    WHERE integration_id=p_integration AND merchant_id=p_merchant AND expected_business_id=p_business
      AND authorized_login=session_user;
  IF count_bindings<>1 THEN RAISE EXCEPTION 'prefunded customer treasury refused' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT treasury FROM prefunded_card.treasury_bindings
    WHERE integration_id=p_integration AND merchant_id=p_merchant AND expected_business_id=p_business
      AND authorized_login=session_user FOR UPDATE;
  PERFORM customer.id FROM public.customers customer JOIN public.customer_savings_goals goal
    ON goal.customer_id=customer.id AND goal.merchant_id=customer.merchant_id
    WHERE customer.id=p_customer AND customer.merchant_id=p_merchant AND customer.user_id=p_actor
      AND goal.id=p_goal FOR SHARE OF customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded customer scope refused' USING ERRCODE='42501'; END IF;
  key_hash:=encode(sha256(convert_to(jsonb_build_array(p_integration,p_merchant,p_customer,p_goal,
    (p_input->>'idempotencyKey')::uuid)::text,'UTF8')),'hex');
  fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_integration,p_merchant,p_customer,p_goal,
    p_actor,(p_input->>'savedMethodId')::uuid,p_input->'amountKobo',p_input->'consent')::text,'UTF8')),'hex');
  SELECT * INTO existing FROM prefunded_card.operations WHERE integration_id=p_integration AND idempotency_key=key_hash FOR UPDATE;
  IF FOUND THEN
    PERFORM prefunded_card.require_credit_route(existing,p_system);
    IF existing.merchant_id<>p_merchant OR existing.customer_id<>p_customer OR existing.goal_id<>p_goal
      OR existing.treasury_binding_id<>treasury.id THEN
      RAISE EXCEPTION 'prefunded customer scope refused' USING ERRCODE='42501';
    END IF;
    IF p_create AND existing.request_fingerprint<>fingerprint THEN
      RAISE EXCEPTION 'prefunded customer idempotency conflict' USING ERRCODE='23505';
    END IF;
    IF p_create AND NOT EXISTS(SELECT 1 FROM prefunded_card.customer_consents consent
      WHERE consent.operation_id=existing.id AND consent.actor_id=p_actor
        AND consent.consent_version='prefunded-card-v1' AND consent.one_time_charge
        AND consent.request_fingerprint=fingerprint AND consent.authorized_login=session_user
        AND consent.system_identifier=p_system AND consent.database_name=current_database()) THEN
      RAISE EXCEPTION 'prefunded customer consent refused' USING ERRCODE='42501';
    END IF;
    RETURN prefunded_card.customer_result(existing.id);
  END IF;
  IF NOT p_create THEN RAISE EXCEPTION 'prefunded customer operation unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM id FROM public.customer_savings_goals WHERE id=p_goal AND merchant_id=p_merchant
    AND customer_id=p_customer AND goal_kind='legacy' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded customer goal unavailable' USING ERRCODE='42501'; END IF;
  authorization_proof:=prefunded_card.read_authorization(treasury.id,p_integration,p_merchant,p_customer,
    (p_input->>'savedMethodId')::uuid,p_system);
  IF authorization_proof->'active' IS DISTINCT FROM 'true'::jsonb OR authorization_proof->'reusable' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'prefunded customer card unavailable' USING ERRCODE='42501';
  END IF;
  SELECT provider_wallet_id,provider_customer_id INTO STRICT mapped FROM piggyvest_staging.wallet_goal_mappings
    WHERE integration_id=p_integration AND merchant_id=p_merchant AND customer_id=p_customer AND goal_id=p_goal FOR SHARE;
  operation_id:=gen_random_uuid();
  command:=jsonb_build_object('operationId',operation_id,'integrationId',p_integration,'merchantId',p_merchant,
    'customerId',p_customer,'goalId',p_goal,'treasuryBindingId',treasury.id,'requestFingerprint',fingerprint,
    'idempotencyKey',key_hash,'savedMethodId',p_input->>'savedMethodId','amountKobo',p_input->'amountKobo',
    'feeAllowanceKobo',0,'currency','NGN','collectionReference','pvbc-'||operation_id,
    'transferReference','pvbt-'||operation_id,'destinationWalletId',mapped.provider_wallet_id,
    'destinationCustomerId',mapped.provider_customer_id);
  PERFORM prefunded_card.reserve(command);
  PERFORM prefunded_card.record_customer_consent(operation_id,p_actor,p_input->'consent',p_system);
  RETURN prefunded_card.customer_result(operation_id);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'prefunded customer request unavailable' USING ERRCODE='42501';
END $$;

CREATE FUNCTION prefunded_card.customer_request(p_integration uuid,p_merchant uuid,p_customer uuid,p_goal uuid,
  p_actor uuid,p_business text,p_system text,p_input jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT prefunded_card.customer_command(p_integration,p_merchant,p_customer,p_goal,p_actor,p_business,p_system,p_input,true)
$$;
CREATE FUNCTION prefunded_card.customer_status(p_integration uuid,p_merchant uuid,p_customer uuid,p_goal uuid,
  p_actor uuid,p_business text,p_system text,p_input jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT prefunded_card.customer_command(p_integration,p_merchant,p_customer,p_goal,p_actor,p_business,p_system,p_input,false)
$$;
REVOKE ALL ON FUNCTION prefunded_card.customer_result(uuid),
  prefunded_card.customer_command(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,boolean),
  prefunded_card.customer_request(uuid,uuid,uuid,uuid,uuid,text,text,jsonb),
  prefunded_card.customer_status(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
