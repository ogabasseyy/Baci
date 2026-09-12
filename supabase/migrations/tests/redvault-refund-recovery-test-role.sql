BEGIN;

CREATE ROLE redvault_refund_test NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER;
GRANT USAGE ON SCHEMA public TO redvault_refund_test;
GRANT EXECUTE ON FUNCTION public.reserve_uba_redvault_refund(uuid, uuid, text, text, jsonb) TO redvault_refund_test;
GRANT EXECUTE ON FUNCTION public.claim_next_uba_redvault_refund() TO redvault_refund_test;
GRANT EXECUTE ON FUNCTION public.finish_uba_redvault_refund(uuid, text, text, text) TO redvault_refund_test;
GRANT EXECUTE ON FUNCTION public.record_uba_redvault_refund_provider_submission(uuid, text, text) TO redvault_refund_test;
GRANT EXECUTE ON FUNCTION public.claim_next_uba_redvault_refund_reconciliation() TO redvault_refund_test;
GRANT EXECUTE ON FUNCTION public.reconcile_uba_redvault_refund(uuid, uuid, text) TO redvault_refund_test;

CREATE FUNCTION public.redvault_refund_fixture_unrelated_rpc() RETURNS boolean
LANGUAGE sql AS $$ SELECT true $$;
REVOKE ALL ON FUNCTION public.redvault_refund_fixture_unrelated_rpc() FROM PUBLIC, redvault_refund_test;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'redvault_refund_test'
      AND (rolcanlogin OR rolbypassrls OR rolsuper OR pg_has_role(oid, 'service_role', 'member'))
  ) THEN
    RAISE EXCEPTION 'local test role has elevated membership';
  END IF;
  IF EXISTS (
    WITH expected(function_id) AS (
      VALUES
        ('public.reserve_uba_redvault_refund(uuid, uuid, text, text, jsonb)'::regprocedure),
        ('public.claim_next_uba_redvault_refund()'::regprocedure),
        ('public.finish_uba_redvault_refund(uuid, text, text, text)'::regprocedure),
        ('public.record_uba_redvault_refund_provider_submission(uuid, text, text)'::regprocedure),
        ('public.claim_next_uba_redvault_refund_reconciliation()'::regprocedure),
        ('public.reconcile_uba_redvault_refund(uuid, uuid, text)'::regprocedure)
    )
    SELECT 1
    FROM expected
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_proc function_row
      CROSS JOIN LATERAL aclexplode(function_row.proacl) privilege
      WHERE function_row.oid = expected.function_id
        AND privilege.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'redvault_refund_test')
        AND privilege.privilege_type = 'EXECUTE'
    )
  ) THEN
    RAISE EXCEPTION 'local test role missing direct refund RPC grant';
  END IF;
  IF has_function_privilege('redvault_refund_test', 'public.redvault_refund_fixture_unrelated_rpc()', 'EXECUTE') THEN
    RAISE EXCEPTION 'local test role received unrelated RPC grant';
  END IF;

  PERFORM set_config(
    'app.redvault_refund_test_attempt_id',
    (SELECT id::text FROM private.uba_redvault_payment_attempts LIMIT 1),
    true
  );
END;
$$;

SELECT set_config('request.jwt.claims', '{"aud":"local","role":"redvault_refund_test"}', true);
SET LOCAL ROLE redvault_refund_test;

DO $$
DECLARE reserved record; claimed record; reconciliation_claim record; reconciled record;
BEGIN
  BEGIN
    PERFORM count(*) FROM private.uba_redvault_refunds;
    RAISE EXCEPTION 'local test role read private refund rows';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.redvault_refund_fixture_unrelated_rpc();
    RAISE EXCEPTION 'local test role invoked unrelated RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT * INTO reserved FROM public.reserve_uba_redvault_refund(
    current_setting('app.redvault_refund_test_attempt_id')::uuid,
    '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    'local-test-role-refund', 'full_capture', NULL
  );
  SELECT * INTO claimed FROM public.claim_next_uba_redvault_refund();
  IF claimed.id IS DISTINCT FROM reserved.id OR claimed.state IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION 'local test role could not claim its scoped refund';
  END IF;
  PERFORM public.record_uba_redvault_refund_provider_submission(
    claimed.id, 'local-provider-refund', 'pending'
  );
  SELECT * INTO reconciliation_claim
  FROM public.claim_next_uba_redvault_refund_reconciliation();
  IF reconciliation_claim.id IS DISTINCT FROM reserved.id
    OR reconciliation_claim.reconciliation_claim_token IS NULL THEN
    RAISE EXCEPTION 'local test role could not obtain a fenced reconciliation claim';
  END IF;
  SELECT * INTO reconciled FROM public.reconcile_uba_redvault_refund(
    reconciliation_claim.id,
    reconciliation_claim.reconciliation_claim_token,
    'processed'
  );
  IF reconciled.state IS DISTINCT FROM 'processed' THEN
    RAISE EXCEPTION 'local test role could not reconcile its fenced claim';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;

SELECT 'REDVAULT local restricted refund-role checks passed' AS result;
