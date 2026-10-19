BEGIN;
ALTER FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb) RENAME TO apply_bound;
ALTER FUNCTION piggyvest_savings_ledger.snapshot(uuid,uuid,uuid,uuid) RENAME TO snapshot_bound;

CREATE FUNCTION piggyvest_savings_ledger.apply(
  p_integration uuid, p_merchant uuid, p_customer uuid, p_goal uuid, p_command jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'ledger requires read committed' USING ERRCODE = '25000';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry
    WHERE registry.id = p_integration AND registry.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ledger integration disabled' USING ERRCODE = '42501'; END IF;
  RETURN piggyvest_savings_ledger.apply_bound(p_integration,p_merchant,p_customer,p_goal,p_command);
END $$;

CREATE FUNCTION piggyvest_savings_ledger.snapshot(
  p_integration uuid, p_merchant uuid, p_customer uuid, p_goal uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'ledger requires read committed' USING ERRCODE = '25000';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry
    WHERE registry.id = p_integration AND registry.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ledger integration disabled' USING ERRCODE = '42501'; END IF;
  RETURN piggyvest_savings_ledger.snapshot_bound(p_integration,p_merchant,p_customer,p_goal);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA piggyvest_savings_ledger FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb) IS
  'Only granted entry point for internal writes: locks enabled existing staging registry FIRST, then private binding/customer/goal. Disabled registry rejects ALL operations, including replay, reversal and settlement; no inferred recovery bypass. apply_bound is private implementation, never grant or catalog it. Existing provider-account registry is configuration, not verified provider ownership or payload evidence.';
COMMENT ON FUNCTION piggyvest_savings_ledger.snapshot(uuid,uuid,uuid,uuid) IS
  'Only granted read entry point: requires enabled staging registry and private caller binding; locks registry then binding/customer/goal. Disabled registry denies snapshots too. snapshot_bound is private implementation, never grant or catalog it. No provider balance or interest inference.';
COMMIT;
