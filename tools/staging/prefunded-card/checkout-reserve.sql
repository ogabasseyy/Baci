BEGIN;

CREATE FUNCTION prefunded_card.checkout_require_executor(p_login name) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF session_user IS DISTINCT FROM p_login
    OR session_user IN ('anon', 'authenticated', 'service_role')
    OR NOT EXISTS (SELECT 1 FROM pg_roles role WHERE role.rolname = session_user
      AND NOT role.rolsuper AND NOT role.rolbypassrls AND NOT role.rolcreaterole
      AND NOT role.rolcreatedb AND NOT role.rolreplication) THEN
    RAISE EXCEPTION 'first-card checkout executor denied' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE FUNCTION prefunded_card.checkout_validate_scope(p_scope jsonb, p_mutation boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_scope IS NULL OR jsonb_typeof(p_scope) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_scope)) <> 7
    OR NOT p_scope ?& ARRAY['deployment','integrationId','merchantId','treasuryBindingId','businessId','systemIdentifier','expiresAt']
    OR jsonb_typeof(p_scope->'deployment') <> 'string'
    OR jsonb_typeof(p_scope->'integrationId') <> 'string'
    OR jsonb_typeof(p_scope->'merchantId') <> 'string'
    OR jsonb_typeof(p_scope->'treasuryBindingId') <> 'string'
    OR jsonb_typeof(p_scope->'businessId') <> 'string'
    OR jsonb_typeof(p_scope->'systemIdentifier') <> 'string'
    OR jsonb_typeof(p_scope->'expiresAt') <> 'string'
    OR p_scope->>'deployment' IS DISTINCT FROM 'staging'
    OR p_scope->>'systemIdentifier' !~ '^[0-9]{1,20}$'
    OR p_scope->>'systemIdentifier' IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system())
    OR p_scope->>'expiresAt' IS DISTINCT FROM '2026-09-29T15:59:10Z'
    OR p_scope->>'integrationId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_scope->>'merchantId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_scope->>'treasuryBindingId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR octet_length(btrim(coalesce(p_scope->>'businessId',''))) NOT BETWEEN 1 AND 512
    OR (p_mutation AND clock_timestamp() >= '2026-09-29T15:59:10Z'::timestamptz) THEN
    RAISE EXCEPTION 'first-card checkout scope denied' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE FUNCTION prefunded_card.checkout_utc_iso(p_value timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT to_char(p_value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

CREATE FUNCTION prefunded_card.checkout_validate_selection(p_selection jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE field_name text;
BEGIN
  IF p_selection IS NULL OR jsonb_typeof(p_selection) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_selection)) <> 4
    OR NOT p_selection ?& ARRAY['intentId','customerId','actorId','goalId'] THEN
    RAISE EXCEPTION 'first-card checkout selection denied' USING ERRCODE = '42501';
  END IF;
  FOREACH field_name IN ARRAY ARRAY['intentId','customerId','actorId','goalId'] LOOP
    IF jsonb_typeof(p_selection->field_name) <> 'string'
      OR p_selection->>field_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'first-card checkout selection denied' USING ERRCODE = '42501';
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION prefunded_card.checkout_validate_request(p_request jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_request))<>6
    OR NOT p_request ?& ARRAY['customerId','actorId','goalId','amountKobo','idempotencyKey','consent']
    OR jsonb_typeof(p_request->'customerId')<>'string' OR jsonb_typeof(p_request->'actorId')<>'string'
    OR jsonb_typeof(p_request->'goalId')<>'string' OR jsonb_typeof(p_request->'idempotencyKey')<>'string'
    OR jsonb_typeof(p_request->'amountKobo')<>'number' OR jsonb_typeof(p_request->'consent')<>'object' THEN
    RAISE EXCEPTION 'first-card checkout request denied' USING ERRCODE = '22023';
  END IF;
  IF p_request->>'customerId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_request->>'actorId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_request->>'goalId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_request->>'idempotencyKey' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_request->>'amountKobo' !~ '^[1-9][0-9]{0,15}$'
    OR p_request->'consent' IS DISTINCT FROM '{"version":"prefunded-first-card-v1","oneTimeCharge":true,"saveCard":true}'::jsonb THEN
    RAISE EXCEPTION 'first-card checkout request denied' USING ERRCODE = '22023';
  END IF;
  IF (p_request->>'amountKobo')::numeric>9007199254740991 THEN
    RAISE EXCEPTION 'first-card checkout request denied' USING ERRCODE = '22023';
  END IF;
END $$;

CREATE FUNCTION prefunded_card.checkout_intent_json(intent prefunded_card.checkout_intents) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('deployment',intent.deployment,'integrationId',intent.integration_id,
    'merchantId',intent.merchant_id,'treasuryBindingId',intent.treasury_binding_id,
    'businessId',intent.business_id,'systemIdentifier',intent.system_identifier,
    'expiresAt','2026-09-29T15:59:10Z','intentId',intent.id,'customerId',intent.customer_id,
    'actorId',intent.actor_id,'goalId',intent.goal_id,'amountKobo',intent.amount_kobo,
    'idempotencyKey',intent.idempotency_key,'consent',jsonb_build_object('version',intent.consent_version,
      'oneTimeCharge',intent.consent_one_time_charge,'saveCard',intent.consent_save_card),
    'email',intent.email,'currency',intent.currency,'reference',intent.reference,
    'requestFingerprint',intent.request_fingerprint);
$$;

CREATE FUNCTION prefunded_card.checkout_snapshot(intent prefunded_card.checkout_intents) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE phase_name text := intent.phase; operation prefunded_card.operations%ROWTYPE;
BEGIN
  SELECT * INTO operation FROM prefunded_card.operations WHERE id = intent.operation_id;
  IF FOUND AND operation.projection_status = 'applied' THEN phase_name := 'completed'; END IF;
  RETURN jsonb_build_object('intent',prefunded_card.checkout_intent_json(intent),'phase',phase_name,
    'session',CASE WHEN phase_name = 'ready' THEN jsonb_build_object('reference',intent.session_reference,
      'authorizationUrl',intent.session_authorization_url) ELSE NULL END,
    'operationId',CASE WHEN phase_name IN ('funding_pending','completed') THEN intent.operation_id ELSE NULL END);
END $$;

CREATE FUNCTION prefunded_card.checkout_lock_intent(
  p_scope jsonb,p_selection jsonb,p_mutation boolean,p_require_operator_login boolean
) RETURNS prefunded_card.checkout_intents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE intent prefunded_card.checkout_intents%ROWTYPE; binding prefunded_card.treasury_bindings%ROWTYPE;
BEGIN
  PERFORM prefunded_card.checkout_validate_scope(p_scope,p_mutation);
  PERFORM prefunded_card.checkout_validate_selection(p_selection);
  SELECT * INTO binding FROM prefunded_card.treasury_bindings WHERE id=(p_scope->>'treasuryBindingId')::uuid
    AND integration_id=(p_scope->>'integrationId')::uuid AND merchant_id=(p_scope->>'merchantId')::uuid
    AND expected_business_id=p_scope->>'businessId' FOR UPDATE;
  IF NOT FOUND OR binding.currency IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'first-card checkout treasury denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO intent FROM prefunded_card.checkout_intents WHERE id=(p_selection->>'intentId')::uuid FOR UPDATE;
  IF NOT FOUND OR intent.integration_id IS DISTINCT FROM (p_scope->>'integrationId')::uuid
    OR intent.merchant_id IS DISTINCT FROM (p_scope->>'merchantId')::uuid
    OR intent.treasury_binding_id IS DISTINCT FROM (p_scope->>'treasuryBindingId')::uuid
    OR intent.business_id IS DISTINCT FROM p_scope->>'businessId' OR intent.system_identifier IS DISTINCT FROM p_scope->>'systemIdentifier'
    OR intent.customer_id IS DISTINCT FROM (p_selection->>'customerId')::uuid
    OR intent.actor_id IS DISTINCT FROM (p_selection->>'actorId')::uuid
    OR intent.goal_id IS DISTINCT FROM (p_selection->>'goalId')::uuid OR intent.database_name IS DISTINCT FROM current_database()
    OR intent.authorized_login IS DISTINCT FROM binding.authorized_login
    OR p_require_operator_login AND intent.authorized_login IS DISTINCT FROM session_user THEN
    RAISE EXCEPTION 'first-card checkout intent denied' USING ERRCODE = '42501';
  END IF;
  PERFORM customer.id FROM public.customers customer WHERE customer.id=intent.customer_id
    AND customer.merchant_id=intent.merchant_id AND customer.user_id=intent.actor_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'first-card checkout ownership denied' USING ERRCODE = '42501'; END IF;
  PERFORM prefunded_card.checkout_validate_scope(p_scope,p_mutation);
  RETURN intent;
END $$;

CREATE FUNCTION prefunded_card.checkout_reserve(p_scope jsonb,p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE; intent prefunded_card.checkout_intents%ROWTYPE;
DECLARE operation prefunded_card.operations%ROWTYPE; goal public.customer_savings_goals%ROWTYPE; mapped record;
DECLARE request_idempotency_hash text; request_fingerprint text; email_value text; pending_kobo bigint; available_kobo bigint;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_treasury_operator');
  PERFORM prefunded_card.checkout_validate_scope(p_scope,false);
  PERFORM prefunded_card.checkout_validate_request(p_request);
  request_idempotency_hash:=encode(sha256(convert_to(jsonb_build_array(p_scope->>'integrationId',p_scope->>'merchantId',
    p_request->>'customerId',p_request->>'actorId',p_request->>'goalId',p_request->>'idempotencyKey')::text,'UTF8')),'hex');
  request_fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_scope,p_request)::text,'UTF8')),'hex');
  SELECT * INTO binding FROM prefunded_card.treasury_bindings WHERE id=(p_scope->>'treasuryBindingId')::uuid
    AND integration_id=(p_scope->>'integrationId')::uuid AND merchant_id=(p_scope->>'merchantId')::uuid
    AND expected_business_id=p_scope->>'businessId' FOR UPDATE;
  IF NOT FOUND OR binding.authorized_login IS DISTINCT FROM session_user OR binding.currency IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'first-card checkout treasury denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO intent FROM prefunded_card.checkout_intents stored
    WHERE stored.idempotency_hash=request_idempotency_hash FOR UPDATE;
  IF FOUND THEN
    PERFORM customer.id FROM public.customers customer WHERE customer.id=intent.customer_id
      AND customer.merchant_id=intent.merchant_id AND customer.user_id=intent.actor_id FOR SHARE;
    IF NOT FOUND OR intent.request_fingerprint IS DISTINCT FROM request_fingerprint OR intent.authorized_login IS DISTINCT FROM session_user
      OR intent.database_name IS DISTINCT FROM current_database() THEN RAISE EXCEPTION 'first-card checkout replay conflict' USING ERRCODE='23505'; END IF;
    RETURN prefunded_card.checkout_snapshot(intent);
  END IF;
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  IF NOT binding.enabled OR NOT prefunded_card.treasury_reservation_ready(binding.id) THEN
    RAISE EXCEPTION 'first-card checkout treasury denied' USING ERRCODE = '42501';
  END IF;
  PERFORM identity.treasury_binding_id FROM prefunded_card.treasury_identities identity
    WHERE identity.treasury_binding_id=binding.id AND identity.integration_id=binding.integration_id
      AND identity.merchant_id=binding.merchant_id AND identity.expected_business_id=binding.expected_business_id
      AND identity.source_wallet_id=binding.source_wallet_id AND identity.authorized_login=binding.authorized_login FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'first-card checkout treasury identity denied' USING ERRCODE='42501'; END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry WHERE registry.id=binding.integration_id
    AND registry.enabled AND registry.expected_provider_account_id=binding.expected_business_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'first-card checkout integration denied' USING ERRCODE='42501'; END IF;
  SELECT lower(btrim(customer.email)) INTO email_value FROM public.customers customer WHERE customer.id=(p_request->>'customerId')::uuid
    AND customer.merchant_id=binding.merchant_id AND customer.user_id=(p_request->>'actorId')::uuid FOR SHARE;
  IF NOT FOUND OR email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR octet_length(email_value)>254 THEN
    RAISE EXCEPTION 'first-card checkout customer denied' USING ERRCODE='42501'; END IF;
  PERFORM method.id FROM public.customer_saved_payment_methods method WHERE method.customer_id=(p_request->>'customerId')::uuid
    AND method.provider='paystack' LIMIT 1 FOR SHARE;
  IF FOUND THEN RAISE EXCEPTION 'first-card checkout already has a card' USING ERRCODE='23505'; END IF;
  PERFORM prior.id FROM prefunded_card.checkout_intents prior WHERE prior.integration_id=binding.integration_id
    AND prior.merchant_id=binding.merchant_id AND prior.customer_id=(p_request->>'customerId')::uuid
    AND prior.phase<>'completed' LIMIT 1 FOR UPDATE;
  IF FOUND THEN RAISE EXCEPTION 'first-card checkout already unresolved' USING ERRCODE='23505'; END IF;
  SELECT * INTO goal FROM public.customer_savings_goals WHERE id=(p_request->>'goalId')::uuid AND merchant_id=binding.merchant_id
    AND customer_id=(p_request->>'customerId')::uuid AND goal_kind='legacy' AND status='active' AND completed_at IS NULL
    AND cancelled_at IS NULL AND spent_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'first-card checkout goal denied' USING ERRCODE='42501'; END IF;
  SELECT provider_wallet_id,provider_customer_id INTO STRICT mapped FROM piggyvest_staging.wallet_goal_mappings WHERE integration_id=binding.integration_id
    AND merchant_id=binding.merchant_id AND customer_id=(p_request->>'customerId')::uuid AND goal_id=goal.id FOR SHARE;
  operation.integration_id:=binding.integration_id; operation.merchant_id:=binding.merchant_id; operation.customer_id:=(p_request->>'customerId')::uuid;
  operation.goal_id:=goal.id; operation.treasury_binding_id:=binding.id; operation.destination_wallet_id:=mapped.provider_wallet_id;
  operation.destination_customer_id:=mapped.provider_customer_id; PERFORM prefunded_card.require_credit_route(operation,p_scope->>'systemIdentifier');
  SELECT coalesce(sum(amount_kobo),0) INTO pending_kobo FROM prefunded_card.operations WHERE goal_id=goal.id
    AND collection_status NOT IN ('verified_failed','reversed') AND projection_status<>'applied';
  available_kobo:=binding.verified_available_kobo-binding.reserved_kobo-binding.consumed_kobo;
  IF (goal.target_amount-goal.current_amount)*100-pending_kobo < (p_request->>'amountKobo')::bigint
    OR available_kobo < (p_request->>'amountKobo')::bigint THEN RAISE EXCEPTION 'first-card checkout capacity denied' USING ERRCODE='23514'; END IF;
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  intent.id:=gen_random_uuid(); intent.operation_id:=intent.id; intent.prepared_saved_method_id:=gen_random_uuid();
  INSERT INTO prefunded_card.checkout_intents(id,operation_id,deployment,integration_id,merchant_id,customer_id,actor_id,goal_id,
    treasury_binding_id,business_id,system_identifier,expires_at,database_name,authorized_login,email,amount_kobo,currency,idempotency_key,
    idempotency_hash,request_fingerprint,reference,transfer_reference,prepared_saved_method_id,consent_version,consent_one_time_charge,consent_save_card)
  VALUES(intent.id,intent.id,'staging',binding.integration_id,binding.merchant_id,(p_request->>'customerId')::uuid,(p_request->>'actorId')::uuid,goal.id,
    binding.id,binding.expected_business_id,p_scope->>'systemIdentifier','2026-09-29T15:59:10Z',current_database(),session_user,email_value,
    (p_request->>'amountKobo')::bigint,'NGN',(p_request->>'idempotencyKey')::uuid,request_idempotency_hash,request_fingerprint,'pvb-first-'||intent.id,
    'pvbt-'||intent.id,intent.prepared_saved_method_id,'prefunded-first-card-v1',true,true);
  INSERT INTO prefunded_card.operations(id,integration_id,merchant_id,customer_id,goal_id,treasury_binding_id,request_fingerprint,idempotency_key,
    saved_method_id,amount_kobo,fee_allowance_kobo,currency,collection_reference,transfer_reference,destination_wallet_id,destination_customer_id,collection_status)
  VALUES(intent.id,binding.integration_id,binding.merchant_id,(p_request->>'customerId')::uuid,goal.id,binding.id,request_fingerprint,request_idempotency_hash,
    intent.prepared_saved_method_id,(p_request->>'amountKobo')::bigint,0,'NGN','pvb-first-'||intent.id,'pvbt-'||intent.id,
    mapped.provider_wallet_id,mapped.provider_customer_id,'pending');
  UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo+(p_request->>'amountKobo')::bigint WHERE id=binding.id;
  SELECT * INTO intent FROM prefunded_card.checkout_intents WHERE id=intent.id;
  RETURN prefunded_card.checkout_snapshot(intent);
END $$;

CREATE OR REPLACE FUNCTION prefunded_card.claim_collection(p_operation uuid,p_fence bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation,false);
  IF p_fence IS NULL OR operation.collection_status<>'not_started' OR operation.collection_fence IS DISTINCT FROM p_fence THEN
    RETURN jsonb_build_object('outcome','stale_or_reconciliation_required');
  END IF;
  operation:=prefunded_card.lock_scoped_operation(p_operation,true);
  IF operation.collection_status<>'not_started' OR operation.collection_fence IS DISTINCT FROM p_fence THEN
    RETURN jsonb_build_object('outcome','stale_or_reconciliation_required');
  END IF;
  UPDATE prefunded_card.operations SET collection_status='dispatching',collection_fence=collection_fence+1,
    collection_attempted_at=clock_timestamp() WHERE id=p_operation;
  RETURN jsonb_build_object('outcome','claimed','operationId',p_operation,'fence',p_fence+1,
    'request',prefunded_card.request_for_operation(operation));
END $$;

REVOKE ALL ON FUNCTION prefunded_card.checkout_require_executor(name),prefunded_card.checkout_validate_scope(jsonb,boolean),
  prefunded_card.checkout_validate_selection(jsonb),prefunded_card.checkout_utc_iso(timestamptz),prefunded_card.checkout_intent_json(prefunded_card.checkout_intents),
  prefunded_card.checkout_validate_request(jsonb),prefunded_card.checkout_snapshot(prefunded_card.checkout_intents),prefunded_card.checkout_lock_intent(jsonb,jsonb,boolean,boolean),
  prefunded_card.checkout_reserve(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
