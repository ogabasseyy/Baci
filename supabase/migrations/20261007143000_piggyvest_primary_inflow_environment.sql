BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary.apply_inflow_environment(integration_id uuid, environment text, receipt jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF environment IS NULL OR environment NOT IN ('staging','production') THEN
    RAISE EXCEPTION 'invalid inflow environment' USING ERRCODE = '22023';
  END IF;
  PERFORM binding.id FROM piggyvest_primary.integrations binding
    WHERE binding.id = apply_inflow_environment.integration_id
      AND binding.environment = apply_inflow_environment.environment AND binding.enabled
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'inflow environment unavailable' USING ERRCODE = '42501'; END IF;
  RETURN piggyvest_primary.apply_inflow(integration_id, receipt);
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.apply_inflow_environment(uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION piggyvest_primary.apply_inflow(uuid,jsonb) FROM piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.apply_inflow_environment(uuid,text,jsonb) TO piggyvest_primary_evidence;
COMMIT;
