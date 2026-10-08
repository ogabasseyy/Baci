BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary.read_savings_status(scope jsonb,operation_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE resolved_intent_id uuid:=piggyvest_primary.assert_savings_scope(scope); operation_state text;
BEGIN
  SELECT operation.state INTO operation_state FROM piggyvest_primary.savings_operations operation
    WHERE operation.id=operation_id AND operation.intent_id=resolved_intent_id
      AND operation.integration_id=(scope->>'integrationId')::uuid;
  RETURN operation_state;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.read_savings_status(jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_savings_status(jsonb,uuid) TO piggyvest_primary_authorizer;
COMMIT;
