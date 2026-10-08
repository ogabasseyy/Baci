-- Authorize card checkout recovery by immutable IDs, not profile email.
-- assert_scope, read_operation, and record_collection compared the request
-- email against the mutable customers row and the stored operation row, so
-- a profile email change after initialization broke both recovery paths:
-- the provider webhook (carrying the original address) failed the
-- current-row check while the client (carrying the new address) failed
-- the stored-row read. Email is not an authorization factor: the
-- integration/merchant/customer/user IDs already bind every call, so the
-- email comparisons are dropped from authorization. The stored checkout
-- email is still compared as provider evidence (saved-token email must
-- match the operation email in record_collection) and still stored at
-- reserve for provider initialization. Scope keeps its 9-key shape.
BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.assert_scope(scope jsonb, evidence_role boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF jsonb_typeof(scope) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(scope)) <> 9 THEN
    RAISE EXCEPTION 'invalid card scope' USING ERRCODE='42501';
  END IF;
  PERFORM config.integration_id FROM piggyvest_primary_card.settings config
  JOIN piggyvest_primary.integrations integration ON integration.id=config.integration_id AND integration.merchant_id=config.merchant_id
  JOIN public.customers customer ON customer.merchant_id=config.merchant_id
  WHERE config.integration_id=(scope->>'integrationId')::uuid
    AND config.merchant_id=(scope->>'merchantId')::uuid AND config.environment=scope->>'environment'
    AND config.business_id=scope->>'businessId' AND integration.business_id=config.business_id
    AND integration.environment=config.environment AND integration.enabled AND config.enabled
    AND config.expires_at > clock_timestamp() AND config.expires_at=(scope->>'expiresAt')::timestamptz
    AND config.callback_url=scope->>'callbackUrl'
    AND SESSION_USER=CASE WHEN evidence_role THEN config.evidence_login ELSE config.authorizer_login END
    AND customer.id=(scope->>'customerId')::uuid AND customer.user_id=(scope->>'userId')::uuid
  FOR SHARE OF config,integration,customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'card ownership unavailable' USING ERRCODE='42501'; END IF;
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.read_operation(scope jsonb, operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation piggyvest_primary_card.operations%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary_card.assert_scope(scope,false);
  SELECT * INTO STRICT operation FROM piggyvest_primary_card.operations WHERE id=operation_id
    AND integration_id=(scope->>'integrationId')::uuid AND merchant_id=(scope->>'merchantId')::uuid
    AND customer_id=(scope->>'customerId')::uuid AND user_id=(scope->>'userId')::uuid;
  RETURN piggyvest_primary_card.project(operation);
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.record_collection(scope jsonb, operation_id uuid, collection jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary_card.operations%ROWTYPE;
  existing piggyvest_primary_card.collections%ROWTYPE;
  token jsonb;
BEGIN
  PERFORM piggyvest_primary_card.assert_scope(scope,true);
  SELECT * INTO STRICT operation FROM piggyvest_primary_card.operations WHERE id=operation_id
    AND integration_id=(scope->>'integrationId')::uuid AND merchant_id=(scope->>'merchantId')::uuid
    AND customer_id=(scope->>'customerId')::uuid AND user_id=(scope->>'userId')::uuid FOR UPDATE;
  IF jsonb_typeof(collection) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(collection)) <> 5
    OR collection->>'reference' IS DISTINCT FROM 'pvb-first-primary-'||operation_id::text
    OR jsonb_typeof(collection->'amountKobo') IS DISTINCT FROM 'number'
    OR (collection->>'amountKobo')::numeric IS DISTINCT FROM operation.amount_kobo::numeric
    OR collection->>'domain' IS DISTINCT FROM (CASE WHEN operation.environment='production' THEN 'live' ELSE 'test' END)
    OR collection->>'providerTransactionId' IS NULL OR collection->>'providerTransactionId' !~ '^[1-9][0-9]{0,19}$'
    OR (collection->>'providerTransactionId')::numeric > 18446744073709551615
    OR NOT collection ? 'token' THEN RAISE EXCEPTION 'invalid collection evidence' USING ERRCODE='22023'; END IF;
  token := NULLIF(collection->'token','null'::jsonb);
  IF token IS NOT NULL AND (operation.consent->'saveCard' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(token) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(token)) <> 4
    OR token->'reusable' IS DISTINCT FROM 'true'::jsonb OR token->>'email' IS DISTINCT FROM operation.email
    OR token->>'authorizationCode' IS NULL OR token->>'authorizationCode' !~ '^AUTH_[A-Za-z0-9_]+$'
    OR octet_length(token->>'authorizationCode') > 512
    OR token->>'customerCode' IS NULL OR token->>'customerCode' !~ '^CUS_[A-Za-z0-9_]+$'
    OR octet_length(token->>'customerCode') > 512) THEN
    RAISE EXCEPTION 'invalid saved card consent' USING ERRCODE='22023';
  END IF;
  SELECT * INTO existing FROM piggyvest_primary_card.collections stored WHERE stored.operation_id=$2;
  IF FOUND THEN
    IF existing.evidence <> collection-'token' OR existing.saved_token IS DISTINCT FROM token THEN
      RAISE EXCEPTION 'collection identity conflict' USING ERRCODE='22023';
    END IF;
    RETURN true;
  END IF;
  IF operation.state NOT IN ('initializing','init_unknown','ready') THEN
    RAISE EXCEPTION 'invalid collection state' USING ERRCODE='22023';
  END IF;
  INSERT INTO piggyvest_primary_card.collections(operation_id,integration_id,environment,provider_transaction_id,evidence,saved_token)
    VALUES(operation.id,operation.integration_id,operation.environment,collection->>'providerTransactionId',collection-'token',token);
  UPDATE piggyvest_primary_card.operations SET state='custody_pending',claim_token=NULL,updated_at=clock_timestamp() WHERE id=operation.id;
  RETURN true;
END $$;
COMMIT;
