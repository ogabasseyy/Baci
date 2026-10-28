-- Catalog-only contracts for privileged PiggyVest routines. These assertions
-- prevent PUBLIC/default EXECUTE grants from silently widening call graphs.
DO $test$
DECLARE
  contract record;
  routine oid;
BEGIN
  FOR contract IN
    SELECT * FROM (VALUES
      ('piggyvest_primary.read_pending_savings(jsonb,uuid)', 'piggyvest_primary_authorizer', true),
      ('piggyvest_primary.has_onboarding(jsonb)', 'piggyvest_primary_provisioner', true),
      ('piggyvest_primary.enqueue_paid_interest_inbox(uuid,text,jsonb)', 'piggyvest_primary_evidence', true),
      ('piggyvest_primary.claim_savings_reconciliation_checkpoint(uuid,text,uuid)', 'piggyvest_primary_evidence', true),
      ('piggyvest_primary.save_savings_reconciliation_checkpoint(uuid,text,jsonb)', 'piggyvest_primary_evidence', true),
      ('piggyvest_primary.finish_savings_reconciliation_checkpoint(uuid,text,jsonb)', 'piggyvest_primary_evidence', true),
      ('piggyvest_primary.clear_terminal_savings_reconciliation_checkpoint()', NULL, true),
      ('savings_interest_private.require_environment()', NULL, true),
      ('savings_interest_private.get_customer_savings_interest_history(uuid)', 'authenticated', true),
      ('public.get_customer_savings_interest_history(uuid)', 'authenticated', false),
      ('public.get_customer_savings_earnings(uuid)', 'authenticated', true),
      ('public.get_customer_savings_earnings(uuid,boolean)', 'authenticated', true),
      ('public.get_customer_savings_interest_snapshot(uuid)', 'authenticated', false)
    ) AS expected(signature, executor_role, security_definer)
  LOOP
    routine := pg_catalog.to_regprocedure(contract.signature);
    IF routine IS NULL THEN
      RAISE EXCEPTION 'required PiggyVest routine is missing: %', contract.signature;
    END IF;

    IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = routine)
      IS DISTINCT FROM contract.security_definer THEN
      RAISE EXCEPTION 'unexpected SECURITY DEFINER property: %', contract.signature;
    END IF;

    IF contract.executor_role IS NOT NULL
      AND NOT pg_catalog.has_function_privilege(contract.executor_role, routine, 'EXECUTE') THEN
      RAISE EXCEPTION 'intended executor % cannot execute %', contract.executor_role, contract.signature;
    END IF;

    IF pg_catalog.has_function_privilege('anon', routine, 'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role', routine, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon or service_role can execute %', contract.signature;
    END IF;

    IF contract.executor_role IS DISTINCT FROM 'authenticated'
      AND pg_catalog.has_function_privilege('authenticated', routine, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated can execute restricted routine %', contract.signature;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) privilege
      LEFT JOIN pg_catalog.pg_roles allowed_role
        ON allowed_role.rolname = contract.executor_role
      WHERE p.oid = routine
        AND privilege.privilege_type = 'EXECUTE'
        AND privilege.grantee <> p.proowner
        AND (
          privilege.grantee = 0
          OR allowed_role.oid IS NULL
          OR privilege.grantee <> allowed_role.oid
        )
    ) THEN
      RAISE EXCEPTION 'unexpected EXECUTE grantee on %', contract.signature;
    END IF;
  END LOOP;
END;
$test$;
