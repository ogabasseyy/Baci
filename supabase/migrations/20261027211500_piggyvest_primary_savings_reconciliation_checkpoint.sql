BEGIN;

CREATE TABLE piggyvest_primary.savings_reconciliation_checkpoints (
  operation_id uuid PRIMARY KEY REFERENCES piggyvest_primary.savings_operations(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id) ON DELETE CASCADE,
  stage text CHECK (stage IS NULL OR stage IN ('date-window','full')),
  fingerprint text CHECK (fingerprint IS NULL OR fingerprint ~ '^[0-9a-f]{64}$'),
  cursor text CHECK (cursor IS NULL OR octet_length(cursor) BETWEEN 1 AND 512),
  page_digest text CHECK (page_digest IS NULL OR page_digest ~ '^[0-9a-f]{64}$'),
  claim_token uuid,
  lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK ((stage IS NULL AND fingerprint IS NULL AND cursor IS NULL AND page_digest IS NULL)
      OR (stage IS NOT NULL AND fingerprint IS NOT NULL AND cursor IS NOT NULL AND page_digest IS NOT NULL)),
  CHECK ((claim_token IS NULL) = (lease_until IS NULL))
);
ALTER TABLE piggyvest_primary.savings_reconciliation_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_savings_reconciliation_checkpoint_deny
  ON piggyvest_primary.savings_reconciliation_checkpoints AS RESTRICTIVE
  FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.savings_reconciliation_checkpoints
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_evidence;

CREATE OR REPLACE FUNCTION piggyvest_primary.claim_savings_reconciliation_checkpoint(
  integration_id uuid, environment text, operation_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  checkpoint piggyvest_primary.savings_reconciliation_checkpoints%ROWTYPE;
  claim uuid;
  operation_intent_id uuid;
  operation_state text;
BEGIN
  PERFORM binding.id FROM piggyvest_primary.integrations binding
    JOIN piggyvest_primary.inflow_authorities authority ON authority.integration_id=binding.id
    WHERE binding.id=claim_savings_reconciliation_checkpoint.integration_id
      AND binding.environment=claim_savings_reconciliation_checkpoint.environment
      AND binding.enabled AND authority.enabled AND authority.executor_login=SESSION_USER
    FOR SHARE OF binding,authority;
  IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation authority unavailable' USING ERRCODE='42501'; END IF;

  SELECT operation.intent_id INTO operation_intent_id
    FROM piggyvest_primary.savings_operations operation
    WHERE operation.id=claim_savings_reconciliation_checkpoint.operation_id
      AND operation.integration_id=claim_savings_reconciliation_checkpoint.integration_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','stale');
  END IF;

  -- Match settle_savings lock order: integration authority, intent advisory
  -- lock, then the savings operation row. Recheck state under that row lock so
  -- a concurrent settlement cannot clean up and then be followed by a stale
  -- checkpoint insert.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('primary-savings:' || operation_intent_id::text,0));
  SELECT operation.state INTO operation_state
    FROM piggyvest_primary.savings_operations operation
    WHERE operation.id=claim_savings_reconciliation_checkpoint.operation_id
      AND operation.integration_id=claim_savings_reconciliation_checkpoint.integration_id
    FOR UPDATE;
  IF NOT FOUND OR operation_state<>'dispatched' THEN
    RETURN jsonb_build_object('status','stale');
  END IF;

  INSERT INTO piggyvest_primary.savings_reconciliation_checkpoints(operation_id,integration_id)
    VALUES(claim_savings_reconciliation_checkpoint.operation_id,
           claim_savings_reconciliation_checkpoint.integration_id)
    ON CONFLICT ON CONSTRAINT savings_reconciliation_checkpoints_pkey DO NOTHING;
  SELECT row.operation_id,row.integration_id,row.stage,row.fingerprint,row.cursor,
         row.page_digest,row.claim_token,row.lease_until,row.updated_at
    INTO checkpoint FROM piggyvest_primary.savings_reconciliation_checkpoints row
    WHERE row.operation_id=claim_savings_reconciliation_checkpoint.operation_id
      AND row.integration_id=claim_savings_reconciliation_checkpoint.integration_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','stale'); END IF;
  IF checkpoint.lease_until > pg_catalog.clock_timestamp() THEN
    RETURN jsonb_build_object('status','busy');
  END IF;
  claim := pg_catalog.gen_random_uuid();
  UPDATE piggyvest_primary.savings_reconciliation_checkpoints row
    SET claim_token=claim, lease_until=pg_catalog.clock_timestamp()+interval '45 seconds',
        updated_at=pg_catalog.clock_timestamp()
    WHERE row.operation_id=checkpoint.operation_id;
  RETURN jsonb_build_object('status','acquired','claimToken',claim,
    'state',jsonb_build_object('stage',checkpoint.stage,'fingerprint',checkpoint.fingerprint,
      'cursor',checkpoint.cursor,'pageDigest',checkpoint.page_digest));
END $$;

CREATE OR REPLACE FUNCTION piggyvest_primary.save_savings_reconciliation_checkpoint(
  integration_id uuid, environment text, command jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_operation_id uuid; v_claim uuid; stage_value text; fingerprint_value text; cursor_value text; digest_value text;
BEGIN
  IF command IS NULL OR jsonb_typeof(command)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(command))<>6
    OR NOT command ?& ARRAY['operationId','claimToken','stage','fingerprint','cursor','pageDigest']
    THEN RAISE EXCEPTION 'invalid checkpoint command' USING ERRCODE='22023'; END IF;
  v_operation_id := (command->>'operationId')::uuid;
  v_claim := (command->>'claimToken')::uuid;
  stage_value := command->>'stage'; fingerprint_value := command->>'fingerprint';
  cursor_value := command->>'cursor'; digest_value := command->>'pageDigest';
  IF NOT ((stage_value IS NULL AND fingerprint_value IS NULL AND cursor_value IS NULL AND digest_value IS NULL)
      OR (stage_value IN ('date-window','full') AND fingerprint_value ~ '^[0-9a-f]{64}$'
        AND digest_value ~ '^[0-9a-f]{64}$' AND octet_length(cursor_value) BETWEEN 1 AND 512)) THEN
    RAISE EXCEPTION 'invalid checkpoint state' USING ERRCODE='22023';
  END IF;
  PERFORM binding.id FROM piggyvest_primary.integrations binding
    JOIN piggyvest_primary.inflow_authorities authority ON authority.integration_id=binding.id
    WHERE binding.id=save_savings_reconciliation_checkpoint.integration_id
      AND binding.environment=save_savings_reconciliation_checkpoint.environment
      AND binding.enabled AND authority.enabled AND authority.executor_login=SESSION_USER
    FOR SHARE OF binding,authority;
  IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation authority unavailable' USING ERRCODE='42501'; END IF;
  UPDATE piggyvest_primary.savings_reconciliation_checkpoints row
    SET stage=stage_value, fingerprint=fingerprint_value, cursor=cursor_value, page_digest=digest_value,
        lease_until=pg_catalog.clock_timestamp()+interval '45 seconds', updated_at=pg_catalog.clock_timestamp()
    WHERE row.operation_id=v_operation_id
      AND row.integration_id=$1
      AND row.claim_token=v_claim AND row.lease_until>pg_catalog.clock_timestamp()
      AND EXISTS (SELECT 1 FROM piggyvest_primary.savings_operations operation
        WHERE operation.id=row.operation_id AND operation.integration_id=row.integration_id AND operation.state='dispatched');
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION piggyvest_primary.finish_savings_reconciliation_checkpoint(
  integration_id uuid, environment text, command jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_operation_id uuid; v_claim uuid; reset_state boolean;
BEGIN
  IF command IS NULL OR jsonb_typeof(command)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(command))<>3
    OR NOT command ?& ARRAY['operationId','claimToken','reset']
    OR jsonb_typeof(command->'reset')<>'boolean' THEN
    RAISE EXCEPTION 'invalid checkpoint finish command' USING ERRCODE='22023';
  END IF;
  v_operation_id := (command->>'operationId')::uuid;
  v_claim := (command->>'claimToken')::uuid;
  reset_state := (command->>'reset')::boolean;
  PERFORM binding.id FROM piggyvest_primary.integrations binding
    JOIN piggyvest_primary.inflow_authorities authority ON authority.integration_id=binding.id
    WHERE binding.id=finish_savings_reconciliation_checkpoint.integration_id
      AND binding.environment=finish_savings_reconciliation_checkpoint.environment
      AND binding.enabled AND authority.enabled AND authority.executor_login=SESSION_USER
    FOR SHARE OF binding,authority;
  IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation authority unavailable' USING ERRCODE='42501'; END IF;
  UPDATE piggyvest_primary.savings_reconciliation_checkpoints row SET
      stage=CASE WHEN reset_state THEN NULL ELSE row.stage END,
      fingerprint=CASE WHEN reset_state THEN NULL ELSE row.fingerprint END,
      cursor=CASE WHEN reset_state THEN NULL ELSE row.cursor END,
      page_digest=CASE WHEN reset_state THEN NULL ELSE row.page_digest END,
      claim_token=NULL, lease_until=NULL, updated_at=pg_catalog.clock_timestamp()
    WHERE row.operation_id=v_operation_id
      AND row.integration_id=$1
      AND row.claim_token=v_claim;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION piggyvest_primary.clear_terminal_savings_reconciliation_checkpoint()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.state IN ('confirmed','cancelled') AND OLD.state IS DISTINCT FROM NEW.state THEN
    DELETE FROM piggyvest_primary.savings_reconciliation_checkpoints WHERE operation_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER primary_savings_checkpoint_terminal_cleanup
  AFTER UPDATE OF state ON piggyvest_primary.savings_operations
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.clear_terminal_savings_reconciliation_checkpoint();

REVOKE ALL ON FUNCTION piggyvest_primary.claim_savings_reconciliation_checkpoint(uuid,text,uuid),
  piggyvest_primary.save_savings_reconciliation_checkpoint(uuid,text,jsonb),
  piggyvest_primary.finish_savings_reconciliation_checkpoint(uuid,text,jsonb),
  piggyvest_primary.clear_terminal_savings_reconciliation_checkpoint()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.claim_savings_reconciliation_checkpoint(uuid,text,uuid),
  piggyvest_primary.save_savings_reconciliation_checkpoint(uuid,text,jsonb),
  piggyvest_primary.finish_savings_reconciliation_checkpoint(uuid,text,jsonb)
  TO piggyvest_primary_evidence;
COMMIT;
