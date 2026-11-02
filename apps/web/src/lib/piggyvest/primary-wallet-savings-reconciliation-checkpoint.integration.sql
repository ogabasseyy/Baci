\set ON_ERROR_STOP on
\ir primary-wallet-savings-dispatch.integration.sql
CREATE TABLE public.customer_savings_contributions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),goal_id uuid,merchant_id uuid,customer_id uuid,
  wallet_transaction_id uuid,amount numeric,source_type text,status text,processed_at timestamptz,
  idempotency_key text UNIQUE,metadata jsonb DEFAULT '{}'
);
\ir ../../../../../supabase/migrations/20261007150000_piggyvest_primary_savings_settlement.sql
\ir ../../../../../supabase/migrations/20261027211500_piggyvest_primary_savings_reconciliation_checkpoint.sql
\ir ../../../../../supabase/migrations/20261029090000_piggyvest_primary_savings_reconciliation_checkpoint_integration_index.sql

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index index_definition
    JOIN pg_catalog.pg_class index_relation
      ON index_relation.oid = index_definition.indexrelid
    JOIN pg_catalog.pg_namespace index_schema
      ON index_schema.oid = index_relation.relnamespace
    WHERE index_schema.nspname = 'piggyvest_primary'
      AND index_relation.relname = 'primary_savings_reconciliation_checkpoint_integration_idx'
      AND index_definition.indrelid =
        'piggyvest_primary.savings_reconciliation_checkpoints'::regclass
      AND index_definition.indisvalid
      AND index_definition.indisready
      AND index_definition.indkey[0] = (
        SELECT attribute.attnum
        FROM pg_catalog.pg_attribute attribute
        WHERE attribute.attrelid = index_definition.indrelid
          AND attribute.attname = 'integration_id'
          AND NOT attribute.attisdropped
      )
  ) THEN
    RAISE EXCEPTION 'checkpoint integration_id index is missing or not leading';
  END IF;
END $$;

SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$
DECLARE
  v_integration uuid := '00000000-0000-4000-8000-000000000004';
  v_operation uuid := '00000000-0000-4000-8000-000000000008';
  v_first jsonb;
  v_busy jsonb;
  v_reclaimed jsonb;
  v_token uuid;
  v_fingerprint text := repeat('a',64);
  v_digest text := repeat('b',64);
BEGIN
  v_first := piggyvest_primary.claim_savings_reconciliation_checkpoint(v_integration,'staging',v_operation);
  IF v_first->>'status'<>'acquired' OR v_first->'state'->>'stage' IS NOT NULL THEN
    RAISE EXCEPTION 'initial claim did not start empty';
  END IF;
  v_token := (v_first->>'claimToken')::uuid;
  PERFORM set_config('test.savings_checkpoint_old_token',v_token::text,false);
  v_busy := piggyvest_primary.claim_savings_reconciliation_checkpoint(v_integration,'staging',v_operation);
  IF v_busy->>'status'<>'busy' THEN RAISE EXCEPTION 'overlapping lease was not rejected'; END IF;
  IF NOT piggyvest_primary.save_savings_reconciliation_checkpoint(v_integration,'staging',jsonb_build_object(
    'operationId',v_operation,'claimToken',v_token,'stage','date-window','fingerprint',v_fingerprint,
    'cursor','provider-cursor-1','pageDigest',v_digest)) THEN RAISE EXCEPTION 'valid state was not saved'; END IF;
  IF piggyvest_primary.save_savings_reconciliation_checkpoint(v_integration,'staging',jsonb_build_object(
    'operationId',v_operation,'claimToken',gen_random_uuid(),'stage','full','fingerprint',v_fingerprint,
    'cursor','forged-cursor','pageDigest',v_digest)) THEN RAISE EXCEPTION 'wrong token overwrote state'; END IF;
  BEGIN
    PERFORM piggyvest_primary.claim_savings_reconciliation_checkpoint(v_integration,'production',v_operation);
    RAISE EXCEPTION 'cross-environment claim accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET SESSION AUTHORIZATION;

UPDATE piggyvest_primary.savings_reconciliation_checkpoints SET lease_until=clock_timestamp()-interval '1 second'
  WHERE operation_id='00000000-0000-4000-8000-000000000008';
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$
DECLARE
  v_integration uuid := '00000000-0000-4000-8000-000000000004';
  v_operation uuid := '00000000-0000-4000-8000-000000000008';
  v_claim jsonb;
  v_old_token uuid := current_setting('test.savings_checkpoint_old_token')::uuid;
  v_new_token uuid;
BEGIN
  v_claim := piggyvest_primary.claim_savings_reconciliation_checkpoint(v_integration,'staging',v_operation);
  IF v_claim->>'status'<>'acquired' OR v_claim->'state'->>'cursor'<>'provider-cursor-1' THEN
    RAISE EXCEPTION 'expired lease did not preserve advisory state';
  END IF;
  v_new_token := (v_claim->>'claimToken')::uuid;
  IF piggyvest_primary.finish_savings_reconciliation_checkpoint(v_integration,'staging',jsonb_build_object(
    'operationId',v_operation,'claimToken',v_old_token,'reset',true)) THEN
    RAISE EXCEPTION 'stale fencing token reset current state';
  END IF;
  IF NOT piggyvest_primary.finish_savings_reconciliation_checkpoint(v_integration,'staging',jsonb_build_object(
    'operationId',v_operation,'claimToken',v_new_token,'reset',true)) THEN RAISE EXCEPTION 'reset failed'; END IF;
END $$;
RESET SESSION AUTHORIZATION;

DO $$
BEGIN
  IF has_table_privilege('primary_evidence_fixture','piggyvest_primary.savings_reconciliation_checkpoints','SELECT') THEN
    RAISE EXCEPTION 'evidence executor has direct table access';
  END IF;
  IF NOT has_function_privilege('primary_evidence_fixture','piggyvest_primary.claim_savings_reconciliation_checkpoint(uuid,text,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','piggyvest_primary.claim_savings_reconciliation_checkpoint(uuid,text,uuid)','EXECUTE')
    OR has_function_privilege('service_role','piggyvest_primary.claim_savings_reconciliation_checkpoint(uuid,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'claim function ACL is not narrow';
  END IF;
  IF NOT has_function_privilege('primary_evidence_fixture','piggyvest_primary.save_savings_reconciliation_checkpoint(uuid,text,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','piggyvest_primary.save_savings_reconciliation_checkpoint(uuid,text,jsonb)','EXECUTE')
    OR has_function_privilege('service_role','piggyvest_primary.save_savings_reconciliation_checkpoint(uuid,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'save function ACL is not narrow';
  END IF;
  IF NOT has_function_privilege('primary_evidence_fixture','piggyvest_primary.finish_savings_reconciliation_checkpoint(uuid,text,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','piggyvest_primary.finish_savings_reconciliation_checkpoint(uuid,text,jsonb)','EXECUTE')
    OR has_function_privilege('service_role','piggyvest_primary.finish_savings_reconciliation_checkpoint(uuid,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'finish function ACL is not narrow';
  END IF;
END $$;
DO $checkpoint_privilege_contract$
DECLARE
  contract record;
  routine oid;
BEGIN
  FOR contract IN
    SELECT * FROM (VALUES
      ('piggyvest_primary.claim_savings_reconciliation_checkpoint(uuid,text,uuid)', 'piggyvest_primary_evidence', true),
      ('piggyvest_primary.save_savings_reconciliation_checkpoint(uuid,text,jsonb)', 'piggyvest_primary_evidence', true),
      ('piggyvest_primary.finish_savings_reconciliation_checkpoint(uuid,text,jsonb)', 'piggyvest_primary_evidence', true),
      ('piggyvest_primary.clear_terminal_savings_reconciliation_checkpoint()', NULL, true)
    ) AS expected(signature, executor_role, security_definer)
  LOOP
    routine := pg_catalog.to_regprocedure(contract.signature);
    IF routine IS NULL THEN
      RAISE EXCEPTION 'required checkpoint routine is missing: %', contract.signature;
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
$checkpoint_privilege_contract$;
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$
DECLARE v_operation uuid := '00000000-0000-4000-8000-000000000008'; v_claim jsonb;
BEGIN
  v_claim := piggyvest_primary.claim_savings_reconciliation_checkpoint(
    '00000000-0000-4000-8000-000000000004','staging',v_operation);
  IF v_claim->>'status'<>'acquired' OR v_claim->'state'->>'stage' IS NOT NULL
    OR v_claim->'state'->>'cursor' IS NOT NULL THEN RAISE EXCEPTION 'reset retained traversal state'; END IF;
  PERFORM piggyvest_primary.finish_savings_reconciliation_checkpoint(
    '00000000-0000-4000-8000-000000000004','staging',jsonb_build_object(
      'operationId',v_operation,'claimToken',v_claim->>'claimToken','reset',false));
END $$;
RESET SESSION AUTHORIZATION;
