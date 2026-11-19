-- Included by piggyvest_preonboarding_savings_recovery.sql inside its transaction.
-- A disabled integration or a disabled savings authority is refused (42501),
-- and re-enabling restores the read. The read also locks the ownership rows
-- and the goal, so a concurrent reservation cannot slip between its checks.
DO $disabled$
DECLARE scope jsonb:=current_setting('test.recovery_scope')::jsonb;
BEGIN
  UPDATE piggyvest_primary.integrations SET enabled = false
    WHERE id = 'f3810000-0000-4000-8000-000000000006';
  BEGIN
    PERFORM piggyvest_primary.read_pending_savings(scope,'f3810000-0000-4000-8000-000000000005');
    RAISE EXCEPTION 'A disabled integration was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE piggyvest_primary.integrations SET enabled = true
    WHERE id = 'f3810000-0000-4000-8000-000000000006';
  UPDATE piggyvest_primary.savings_authorities SET enabled = false
    WHERE integration_id = 'f3810000-0000-4000-8000-000000000006';
  BEGIN
    PERFORM piggyvest_primary.read_pending_savings(scope,'f3810000-0000-4000-8000-000000000005');
    RAISE EXCEPTION 'A disabled savings authority was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE piggyvest_primary.savings_authorities SET enabled = true
    WHERE integration_id = 'f3810000-0000-4000-8000-000000000006';
  IF pg_catalog.pg_get_functiondef('piggyvest_primary.read_pending_savings(jsonb,uuid)'::regprocedure)
    !~ 'FOR SHARE OF binding,\s*authority,\s*customer,\s*goal' THEN
    RAISE EXCEPTION 'read_pending_savings no longer locks its ownership rows and goal';
  END IF;
  PERFORM piggyvest_primary.read_pending_savings(scope,'f3810000-0000-4000-8000-000000000005');
END;
$disabled$;
