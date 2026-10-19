BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = pg_catalog;
DO $pin$ BEGIN
  IF current_database() <> 'postgres' OR session_user <> 'postgres'
    OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system()) <> '7685292944002592802' THEN
    RAISE EXCEPTION 'staging database identity differs' USING ERRCODE = '42501';
  END IF;
END $pin$;
DO $interest$
DECLARE
  allocations_relation oid := to_regclass('piggyvest_savings_ledger.interest_allocations');
  receipts_relation oid := to_regclass('piggyvest_savings_ledger.interest_receipts');
  allocation_count bigint;
  enabled_count bigint;
  receipt_count bigint;
BEGIN
  IF allocations_relation IS NOT NULL THEN
    EXECUTE $counts$SELECT count(*), count(*) FILTER (WHERE enabled)
      FROM piggyvest_savings_ledger.interest_allocations
      WHERE integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'::uuid
        AND merchant_id='10000000-0000-4000-8000-000000000001'::uuid
        AND customer_id='10000000-0000-4000-8000-000000000002'::uuid
        AND goal_id='430314fd-cd8b-4579-98d4-e9f345713dd6'::uuid
    $counts$ INTO allocation_count, enabled_count;
    IF receipts_relation IS NOT NULL THEN
      EXECUTE $receipts$SELECT count(*)
        FROM piggyvest_savings_ledger.interest_receipts receipt
        JOIN piggyvest_savings_ledger.interest_allocations allocation ON allocation.id=receipt.allocation_id
        WHERE allocation.integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'::uuid
          AND allocation.merchant_id='10000000-0000-4000-8000-000000000001'::uuid
          AND allocation.customer_id='10000000-0000-4000-8000-000000000002'::uuid
          AND allocation.goal_id='430314fd-cd8b-4579-98d4-e9f345713dd6'::uuid
      $receipts$ INTO receipt_count;
    END IF;
  END IF;
  PERFORM set_config('baci.renewal_interest_inventory', jsonb_build_object(
    'allocationsPresent', allocations_relation IS NOT NULL, 'receiptsPresent', receipts_relation IS NOT NULL,
    'allocationCount', allocation_count, 'enabledAllocationCount', enabled_count,
    'receiptCount', receipt_count)::text, true);
END $interest$;
SELECT jsonb_build_object(
  'systemIdentifier', (SELECT system_identifier::text FROM pg_control_system()),
  'readOnly', current_setting('transaction_read_only') = 'on',
  'roles', (SELECT jsonb_agg(jsonb_build_object('name', rolname, 'expiresAt', rolvaliduntil,
    'login', rolcanlogin, 'superuser', rolsuper, 'bypassRls', rolbypassrls) ORDER BY rolname)
    FROM pg_roles WHERE left(rolname, 10) = 'prefunded_'
      OR rolname IN ('baci_savings_notifications_worker', 'pvb_staging_app_worker', 'pvb_staging_worker',
                    'piggyvest_staging_ledger_worker')),
  'interestBridge', current_setting('baci.renewal_interest_inventory')::jsonb || jsonb_build_object(
    'worker', (SELECT jsonb_build_object('name', expected.name, 'present', worker.oid IS NOT NULL,
      'login', worker.rolcanlogin, 'expiresAt', worker.rolvaliduntil,
      'superuser', worker.rolsuper, 'bypassRls', worker.rolbypassrls,
      'schemaUsage', CASE WHEN worker.oid IS NULL OR to_regnamespace('piggyvest_savings_ledger') IS NULL
        THEN false ELSE has_schema_privilege(worker.oid, to_regnamespace('piggyvest_savings_ledger'), 'USAGE') END)
      FROM (VALUES ('piggyvest_staging_ledger_worker')) expected(name)
      LEFT JOIN pg_roles worker ON worker.rolname=expected.name),
    'functions', (SELECT jsonb_agg(jsonb_build_object('signature', expected.signature,
      'present', routine.oid IS NOT NULL,
      'definitionSha256', encode(sha256(convert_to(pg_get_functiondef(routine.oid), 'UTF8')), 'hex'),
      'owner', pg_get_userbyid(routine.proowner), 'securityDefiner', routine.prosecdef,
      'workerExecute', CASE WHEN routine.oid IS NULL OR to_regrole('piggyvest_staging_ledger_worker') IS NULL
        THEN false ELSE has_function_privilege(to_regrole('piggyvest_staging_ledger_worker'), routine.oid, 'EXECUTE') END)
      ORDER BY expected.position)
      FROM (VALUES
        (1, 'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)'),
        (2, 'public.get_customer_savings_earnings(uuid)'),
        (3, 'savings_notifications.interest_recorded()')) expected(position, signature)
      LEFT JOIN pg_proc routine ON routine.oid=to_regprocedure(expected.signature))),
  'principalKobo', (SELECT current_amount * 100 FROM public.customer_savings_goals
    WHERE id = '430314fd-cd8b-4579-98d4-e9f345713dd6'
      AND customer_id = '10000000-0000-4000-8000-000000000002'
      AND merchant_id = '10000000-0000-4000-8000-000000000001'),
  'treasury', (SELECT jsonb_build_object('id', id, 'enabled', enabled,
    'verifiedAvailableKobo', verified_available_kobo, 'reservedKobo', reserved_kobo, 'consumedKobo', consumed_kobo)
    FROM prefunded_card.treasury_bindings WHERE id = 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57'),
  'intents', (SELECT jsonb_agg(jsonb_build_object('id', id, 'phase', phase,
    'amountKobo', amount_kobo, 'expiresAt', expires_at) ORDER BY id) FROM prefunded_card.checkout_intents),
  'operations', (SELECT jsonb_agg(jsonb_build_object('id', id, 'retired', checkout_retired,
    'collection', collection_status, 'transfer', transfer_status, 'projection', projection_status)
    ORDER BY id) FROM prefunded_card.operations),
  'retirementAuditRows', (SELECT count(*) FROM prefunded_card.checkout_retirements),
  'snapshotVerifier', (SELECT jsonb_agg(jsonb_build_object('login', login_name, 'expiresAt', expires_at))
    FROM prefunded_card.treasury_verifier_bindings),
  'deadlineFunctions', (SELECT jsonb_agg(jsonb_build_object('schema', namespace.nspname,
    'name', procedure.proname, 'arguments', pg_get_function_identity_arguments(procedure.oid),
    'bodySha256', encode(sha256(convert_to(procedure.prosrc, 'UTF8')), 'hex'),
    'owner', pg_get_userbyid(procedure.proowner), 'securityDefiner', procedure.prosecdef)
    ORDER BY namespace.nspname, procedure.proname)
    FROM pg_proc procedure JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE (namespace.nspname IN ('prefunded_card', 'piggyvest_staging', 'piggyvest_savings_ledger', 'savings_notifications')
      OR (namespace.nspname = 'public' AND procedure.proname IN (
        'recognize_piggyvest_staging_inflow', 'resolve_piggyvest_staging_goal_mapping')))
      AND (procedure.prosrc LIKE '%2026-09-29%' OR procedure.prosrc LIKE '%1790697550%')),
  'deadlineConstraints', (SELECT jsonb_agg(jsonb_build_object('table', relation.relname,
    'name', constraint_row.conname, 'definitionSha256',
    encode(sha256(convert_to(pg_get_constraintdef(constraint_row.oid), 'UTF8')), 'hex')))
    FROM pg_constraint constraint_row JOIN pg_class relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'prefunded_card'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%2026-09-29%')
);
ROLLBACK;
