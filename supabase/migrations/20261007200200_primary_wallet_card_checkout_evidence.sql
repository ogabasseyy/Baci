BEGIN;
CREATE FUNCTION piggyvest_primary_card.record_collection(scope jsonb, operation_id uuid, collection jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary_card.operations%ROWTYPE;
  existing piggyvest_primary_card.collections%ROWTYPE;
  token jsonb;
BEGIN
  PERFORM piggyvest_primary_card.assert_scope(scope,true);
  SELECT * INTO STRICT operation FROM piggyvest_primary_card.operations WHERE id=operation_id
    AND integration_id=(scope->>'integrationId')::uuid AND merchant_id=(scope->>'merchantId')::uuid
    AND customer_id=(scope->>'customerId')::uuid AND user_id=(scope->>'userId')::uuid AND email=scope->>'email' FOR UPDATE;
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
CREATE FUNCTION piggyvest_primary_card.flag_reconciliation(scope jsonb, operation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary_card.assert_scope(scope,true);
  UPDATE piggyvest_primary_card.operations SET state='reconciliation_required',claim_token=NULL,updated_at=clock_timestamp()
    WHERE id=operation_id AND integration_id=(scope->>'integrationId')::uuid AND merchant_id=(scope->>'merchantId')::uuid
    AND customer_id=(scope->>'customerId')::uuid AND user_id=(scope->>'userId')::uuid AND state <> 'custody_pending';
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary_card.record_collection(jsonb,uuid,jsonb),piggyvest_primary_card.flag_reconciliation(jsonb,uuid)
  FROM PUBLIC,anon,authenticated,service_role,primary_card_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary_card.record_collection(jsonb,uuid,jsonb),piggyvest_primary_card.flag_reconciliation(jsonb,uuid) TO primary_card_evidence;
COMMIT;
