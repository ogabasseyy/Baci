-- Drain pre-expiry card operations after the integration expires.
-- assert_scope requires config.expires_at > clock_timestamp(), so once the
-- deadline passes even read_operation and record_collection fail with
-- 'card ownership unavailable': a customer who pays (or whose provider
-- webhook lands) after expiry stays charged-but-uncredited, and status
-- polling can never resolve. The deadline must block NEW reservations
-- only. Add a drain overload of assert_scope that skips the freshness
-- check while keeping every other binding — including the presented
-- expiresAt equality, so a caller cannot substitute a different deadline
-- — and route the existing-operation functions through it: read,
-- collection, abandonment, and reconciliation. reserve keeps the strict
-- two-argument form, and claim/record_initialization inherit the drain
-- through their read_operation call. flag_reconciliation additionally
-- drops its reservations %ROWTYPE (091500 precedent) so this migration
-- applies in chains that predate the treasury tables; behavior is
-- unchanged where the tables exist.
BEGIN;
CREATE FUNCTION piggyvest_primary_card.assert_scope(scope jsonb, evidence_role boolean, drain boolean)
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
    AND (drain OR config.expires_at > clock_timestamp()) AND config.expires_at=(scope->>'expiresAt')::timestamptz
    AND config.callback_url=scope->>'callbackUrl'
    AND SESSION_USER=CASE WHEN evidence_role THEN config.evidence_login ELSE config.authorizer_login END
    AND customer.id=(scope->>'customerId')::uuid AND customer.user_id=(scope->>'userId')::uuid
  FOR SHARE OF config,integration,customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'card ownership unavailable' USING ERRCODE='42501'; END IF;
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.assert_scope(scope jsonb, evidence_role boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary_card.assert_scope(scope,evidence_role,false);
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.read_operation(scope jsonb, operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation piggyvest_primary_card.operations%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary_card.assert_scope(scope,false,true);
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
  PERFORM piggyvest_primary_card.assert_scope(scope,true,true);
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
CREATE OR REPLACE FUNCTION piggyvest_primary_card.record_abandonment(scope jsonb, operation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary_card.operations%ROWTYPE;
  reservation_binding_id uuid;
BEGIN
  PERFORM piggyvest_primary_card.assert_scope(scope,true,true);
  SELECT * INTO operation FROM piggyvest_primary_card.operations WHERE id=operation_id
    AND integration_id=(scope->>'integrationId')::uuid AND merchant_id=(scope->>'merchantId')::uuid
    AND customer_id=(scope->>'customerId')::uuid AND user_id=(scope->>'userId')::uuid
    AND state IN ('initializing','init_unknown','ready','abandoned') FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF operation.state <> 'abandoned' THEN
    UPDATE piggyvest_primary_card.operations SET state='abandoned',claim_token=NULL,updated_at=clock_timestamp()
      WHERE id=operation_id;
    IF to_regclass('piggyvest_primary_card.reservations') IS NOT NULL THEN
      SELECT reservations.treasury_binding_id INTO reservation_binding_id FROM piggyvest_primary_card.reservations
        WHERE reservations.operation_id=operation.id AND state='reserved' FOR UPDATE;
      IF FOUND THEN
        UPDATE piggyvest_primary_card.reservations SET state='released' WHERE reservations.operation_id=operation.id;
        IF to_regclass('prefunded_card.treasury_bindings') IS NOT NULL THEN
          EXECUTE 'UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo-$2 WHERE id=$1'
            USING reservation_binding_id,operation.amount_kobo;
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.flag_reconciliation(scope jsonb, operation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary_card.operations%ROWTYPE;
  reservation_binding_id uuid;
BEGIN
  PERFORM piggyvest_primary_card.assert_scope(scope,true,true);
  SELECT * INTO operation FROM piggyvest_primary_card.operations WHERE id=operation_id
    AND integration_id=(scope->>'integrationId')::uuid AND merchant_id=(scope->>'merchantId')::uuid
    AND customer_id=(scope->>'customerId')::uuid AND user_id=(scope->>'userId')::uuid
    AND state IN ('reserved','initializing','init_unknown','ready') FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE piggyvest_primary_card.operations SET state='reconciliation_required',claim_token=NULL,updated_at=clock_timestamp()
    WHERE id=operation_id;
  IF to_regclass('piggyvest_primary_card.reservations') IS NOT NULL THEN
    SELECT reservations.treasury_binding_id INTO reservation_binding_id FROM piggyvest_primary_card.reservations
      WHERE reservations.operation_id=operation.id AND state='reserved' FOR UPDATE;
    IF FOUND THEN
      UPDATE piggyvest_primary_card.reservations SET state='released' WHERE reservations.operation_id=operation.id;
      IF to_regclass('prefunded_card.treasury_bindings') IS NOT NULL THEN
        EXECUTE 'UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo-$2 WHERE id=$1'
          USING reservation_binding_id,operation.amount_kobo;
      END IF;
    END IF;
  END IF;
  RETURN true;
END $$;
COMMIT;
