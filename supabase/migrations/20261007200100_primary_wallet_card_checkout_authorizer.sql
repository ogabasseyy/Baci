BEGIN;
CREATE FUNCTION piggyvest_primary_card.read_operation(scope jsonb, operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation piggyvest_primary_card.operations%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary_card.assert_scope(scope,false);
  SELECT * INTO STRICT operation FROM piggyvest_primary_card.operations WHERE id=operation_id
    AND integration_id=(scope->>'integrationId')::uuid AND merchant_id=(scope->>'merchantId')::uuid
    AND customer_id=(scope->>'customerId')::uuid AND user_id=(scope->>'userId')::uuid AND email=scope->>'email';
  RETURN piggyvest_primary_card.project(operation);
END $$;
CREATE FUNCTION piggyvest_primary_card.reserve(scope jsonb, request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary_card.operations%ROWTYPE;
  mapping piggyvest_primary.onboarding_intents%ROWTYPE;
  fingerprint text;
BEGIN
  PERFORM piggyvest_primary_card.assert_scope(scope,false);
  IF jsonb_typeof(request) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(request)) <> 3
    OR jsonb_typeof(request->'amountKobo') IS DISTINCT FROM 'number'
    OR (request->>'amountKobo')::numeric <> trunc((request->>'amountKobo')::numeric)
    OR (request->>'amountKobo')::numeric NOT BETWEEN 1 AND 9999999999
    OR jsonb_typeof(request->'consent') IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(request->'consent')) <> 3
    OR request->'consent'->>'version' IS DISTINCT FROM 'primary-wallet-card-v1'
    OR request->'consent'->'oneTimeCharge' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(request->'consent'->'saveCard') IS DISTINCT FROM 'boolean'
    OR request->>'idempotencyKey' IS NULL THEN
    RAISE EXCEPTION 'invalid card reservation' USING ERRCODE='22023';
  END IF;
  SELECT * INTO STRICT mapping FROM piggyvest_primary.onboarding_intents WHERE integration_id=(scope->>'integrationId')::uuid
    AND merchant_id=(scope->>'merchantId')::uuid AND customer_id=(scope->>'customerId')::uuid
    AND user_id=(scope->>'userId')::uuid AND state='verified' FOR SHARE;
  fingerprint := encode(sha256(convert_to(jsonb_build_object('scope',scope-'expiresAt'-'callbackUrl',
    'request',request,'wallet',mapping.provider_wallet_id,'providerCustomer',mapping.provider_customer_id)::text,'UTF8')),'hex');
  INSERT INTO piggyvest_primary_card.operations(integration_id,merchant_id,customer_id,user_id,environment,business_id,email,
    idempotency_key,amount_kobo,consent,fingerprint,destination_wallet_id,destination_customer_id,state)
  VALUES((scope->>'integrationId')::uuid,(scope->>'merchantId')::uuid,(scope->>'customerId')::uuid,(scope->>'userId')::uuid,
    scope->>'environment',scope->>'businessId',scope->>'email',(request->>'idempotencyKey')::uuid,
    (request->>'amountKobo')::bigint,request->'consent',fingerprint,mapping.provider_wallet_id,mapping.provider_customer_id,'reserved')
  ON CONFLICT(integration_id,customer_id,idempotency_key) DO NOTHING RETURNING * INTO operation;
  IF NOT FOUND THEN
    SELECT * INTO STRICT operation FROM piggyvest_primary_card.operations WHERE integration_id=(scope->>'integrationId')::uuid
      AND customer_id=(scope->>'customerId')::uuid AND idempotency_key=(request->>'idempotencyKey')::uuid FOR UPDATE;
    IF operation.fingerprint <> fingerprint OR operation.user_id <> (scope->>'userId')::uuid THEN
      RAISE EXCEPTION 'card reservation conflict' USING ERRCODE='22023';
    END IF;
  END IF;
  RETURN piggyvest_primary_card.project(operation);
END $$;
CREATE FUNCTION piggyvest_primary_card.claim_initialization(scope jsonb, operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation piggyvest_primary_card.operations%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary_card.read_operation(scope,operation_id);
  SELECT * INTO STRICT operation FROM piggyvest_primary_card.operations WHERE id=operation_id FOR UPDATE;
  IF operation.state <> 'reserved' THEN
    RETURN jsonb_build_object('outcome','existing','intent',piggyvest_primary_card.project(operation));
  END IF;
  UPDATE piggyvest_primary_card.operations SET state='initializing',claim_token=gen_random_uuid(),updated_at=clock_timestamp()
    WHERE id=operation_id RETURNING * INTO operation;
  RETURN jsonb_build_object('outcome','claimed','token',operation.claim_token,'intent',piggyvest_primary_card.project(operation));
END $$;
CREATE FUNCTION piggyvest_primary_card.record_initialization(scope jsonb, operation_id uuid, token uuid, session jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary_card.read_operation(scope,operation_id);
  IF session IS NOT NULL AND (jsonb_typeof(session) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(session)) <> 2
    OR session->>'reference' IS DISTINCT FROM 'pvb-first-primary-'||operation_id::text
    OR session->>'authorizationUrl' IS NULL
    OR octet_length(session->>'authorizationUrl') > 512
    OR session->>'authorizationUrl' !~ '^https://checkout\.paystack\.com/[A-Za-z0-9]+$') THEN
    RAISE EXCEPTION 'invalid checkout session' USING ERRCODE='22023';
  END IF;
  UPDATE piggyvest_primary_card.operations SET state=CASE WHEN session IS NULL THEN 'init_unknown' ELSE 'ready' END,
    claim_token=NULL,authorization_url=session->>'authorizationUrl',updated_at=clock_timestamp()
  WHERE id=operation_id AND state='initializing' AND claim_token=token;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary_card.read_operation(jsonb,uuid),piggyvest_primary_card.reserve(jsonb,jsonb),
  piggyvest_primary_card.claim_initialization(jsonb,uuid),piggyvest_primary_card.record_initialization(jsonb,uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,primary_card_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary_card.read_operation(jsonb,uuid),piggyvest_primary_card.reserve(jsonb,jsonb),
  piggyvest_primary_card.claim_initialization(jsonb,uuid),piggyvest_primary_card.record_initialization(jsonb,uuid,uuid,jsonb) TO primary_card_authorizer;
COMMIT;
