-- Return the customer's existing unresolved operation when a fresh
-- idempotency key collides with the one-unresolved-operation index.
-- When local storage is lost (cleared AsyncStorage, reinstall) the client
-- loses its operation ID and starts with a new key; previously the index
-- violation surfaced as a generic 503 with no recovery path. Returning the
-- existing operation lets the normal claim flow resume it: the service
-- still rejects amount/consent mismatches, so a same-amount retry
-- recovers the checkout while a changed funding request fails loudly
-- instead of hijacking the stored intent. Cross-user access raises a
-- conflict rather than leaking the stored operation.
BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.reserve(scope jsonb, request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary_card.operations%ROWTYPE;
  mapping piggyvest_primary.onboarding_intents%ROWTYPE;
  fingerprint text;
  attempt integer;
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
  FOR attempt IN 1..2 LOOP
    BEGIN
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
    EXCEPTION WHEN unique_violation THEN
      SELECT * INTO operation FROM piggyvest_primary_card.operations WHERE integration_id=(scope->>'integrationId')::uuid
        AND customer_id=(scope->>'customerId')::uuid
        AND state IN ('reserved','initializing','init_unknown','ready','custody_pending','reconciliation_required') FOR UPDATE;
      IF FOUND THEN
        IF operation.user_id <> (scope->>'userId')::uuid THEN
          RAISE EXCEPTION 'card reservation conflict' USING ERRCODE='22023';
        END IF;
        RETURN piggyvest_primary_card.project(operation);
      END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'card reservation unavailable' USING ERRCODE='40001';
END $$;
COMMIT;
