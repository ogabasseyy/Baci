BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL search_path = pg_catalog;
DO $pin$
BEGIN
  IF current_database() <> 'postgres' OR session_user <> 'postgres'
    OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system()) <> '7685292944002592802' THEN
    RAISE EXCEPTION 'staging app database identity differs' USING ERRCODE = '42501';
  END IF;
END
$pin$;
SELECT jsonb_build_object(
  'systemIdentifier', (SELECT system_identifier::text FROM pg_control_system()),
  'readOnly', current_setting('transaction_read_only') = 'on',
  'roles', (SELECT jsonb_agg(jsonb_build_object('name', expected.name,
      'present', role.oid IS NOT NULL, 'login', role.rolcanlogin,
      'expiresAt', role.rolvaliduntil, 'unsafe', coalesce(role.rolsuper OR role.rolbypassrls
        OR role.rolcreaterole OR role.rolcreatedb OR role.rolreplication, false))
      ORDER BY expected.name)
    FROM (VALUES ('prefunded_treasury_operator'), ('prefunded_authorizer'),
      ('prefunded_evidence')) expected(name)
    LEFT JOIN pg_roles role ON role.rolname=expected.name),
  'state', jsonb_build_object(
    'goalId', '430314fd-cd8b-4579-98d4-e9f345713dd6',
    'principalKobo', (SELECT current_amount * 100 FROM public.customer_savings_goals
      WHERE id='430314fd-cd8b-4579-98d4-e9f345713dd6'
        AND customer_id='10000000-0000-4000-8000-000000000002'
        AND merchant_id='10000000-0000-4000-8000-000000000001'),
    'intent', (SELECT jsonb_build_object('id', intent.id, 'phase', intent.phase,
      'amountKobo', intent.amount_kobo,
      'expiresAt', to_char(intent.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'goalId', intent.goal_id, 'customerId', intent.customer_id,
      'merchantId', intent.merchant_id, 'integrationId', intent.integration_id,
      'treasuryBindingId', intent.treasury_binding_id)
      FROM prefunded_card.checkout_intents intent
      WHERE intent.id='d8bcf921-61b3-4647-90e2-5648e4d6967d'),
    'treasuryBudgetKobo', (SELECT treasury_identity.opening_available_kobo + coalesce(sum(replenishment.amount_kobo), 0)
      FROM prefunded_card.treasury_identities treasury_identity
      LEFT JOIN prefunded_card.treasury_replenishments replenishment
        ON replenishment.treasury_binding_id=treasury_identity.treasury_binding_id
      WHERE treasury_identity.treasury_binding_id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57'
      GROUP BY treasury_identity.opening_available_kobo),
    'treasuryReservedKobo', (SELECT reserved_kobo FROM prefunded_card.treasury_bindings
      WHERE id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57'),
    'treasuryAvailableKobo', (SELECT verified_available_kobo FROM prefunded_card.treasury_bindings
      WHERE id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57'),
    'treasuryConsumedKobo', (SELECT consumed_kobo FROM prefunded_card.treasury_bindings
      WHERE id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57'),
    'retiredIntentId', (SELECT id FROM prefunded_card.checkout_intents
      WHERE id='d8bcf921-61b3-4647-90e2-5648e4d6967d'),
    'retiredIntentPhase', (SELECT phase FROM prefunded_card.checkout_intents
      WHERE id='d8bcf921-61b3-4647-90e2-5648e4d6967d'),
    'retiredIntentAmountKobo', (SELECT amount_kobo FROM prefunded_card.checkout_intents
      WHERE id='d8bcf921-61b3-4647-90e2-5648e4d6967d'),
    'retiredOperation', (SELECT jsonb_build_object('id', id, 'retired', checkout_retired,
      'collection', collection_status, 'transfer', transfer_status, 'projection', projection_status)
      FROM prefunded_card.operations WHERE id='d8bcf921-61b3-4647-90e2-5648e4d6967d'),
    'otherIntentCount', (SELECT count(*) FROM prefunded_card.checkout_intents
      WHERE id<>'d8bcf921-61b3-4647-90e2-5648e4d6967d'),
    'otherOperationCount', (SELECT count(*) FROM prefunded_card.operations
      WHERE id<>'d8bcf921-61b3-4647-90e2-5648e4d6967d'),
    'newPaymentStarted', EXISTS(SELECT 1 FROM prefunded_card.checkout_intents
        WHERE id<>'d8bcf921-61b3-4647-90e2-5648e4d6967d')
      OR EXISTS(SELECT 1 FROM prefunded_card.operations
        WHERE id<>'d8bcf921-61b3-4647-90e2-5648e4d6967d'),
    'retirementAuditCount', (SELECT count(*) FROM prefunded_card.checkout_retirements),
    'retirementAudit', (SELECT jsonb_build_object('intentId', intent_id,
      'operationId', operation_id, 'intentBeforeSha256', intent_before_sha256,
      'operationBeforeSha256', operation_before_sha256)
      FROM prefunded_card.checkout_retirements
      WHERE operation_id='d8bcf921-61b3-4647-90e2-5648e4d6967d'),
    'creditRouteCount', (SELECT count(*) FROM prefunded_card.credit_routes
      WHERE integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'
        AND merchant_id='10000000-0000-4000-8000-000000000001'),
    'providerEvidenceCount', (SELECT count(*) FROM prefunded_card.provider_evidence
      WHERE integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'),
    'attributionCount', (SELECT count(*) FROM prefunded_card.inflow_attributions
      WHERE integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'),
    'conflictCount', (SELECT count(*) FROM prefunded_card.evidence_conflicts
      WHERE integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'),
    'projectionCount', (SELECT count(*) FROM prefunded_card.projections)
  ),
  'functions', (SELECT jsonb_agg(jsonb_build_object(
      'signature', expected.signature,
      'present', routine.oid IS NOT NULL,
      'oid', routine.oid::text,
      'owner', pg_get_userbyid(routine.proowner),
      'language', lang.lanname,
      'securityDefiner', routine.prosecdef,
      'configuration', routine.proconfig,
      'acl', routine.proacl::text,
      'bodyMd5', md5(routine.prosrc),
      'definitionSha256', encode(sha256(convert_to(pg_get_functiondef(routine.oid), 'UTF8')), 'hex'))
      ORDER BY expected.signature)
    FROM (VALUES
      (1, 'prefunded_card.checkout_validate_scope(jsonb,boolean)'),
      (2, 'prefunded_card.checkout_intent_json(prefunded_card.checkout_intents)'),
      (3, 'prefunded_card.checkout_reserve(jsonb,jsonb)'),
      (4, 'prefunded_card.checkout_claim_initialization(jsonb,jsonb)'),
      (5, 'prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)')
    ) expected(position, signature)
    LEFT JOIN pg_proc routine ON routine.oid=to_regprocedure(expected.signature)
    LEFT JOIN pg_language lang ON lang.oid=routine.prolang),
  'constraints', (SELECT jsonb_agg(jsonb_build_object('table', relation.relname,
      'name', constraint_row.conname,
      'oid', constraint_row.oid::text,
      'definitionSha256', encode(sha256(convert_to(pg_get_constraintdef(constraint_row.oid), 'UTF8')), 'hex'))
      ORDER BY relation.relname, constraint_row.conname)
    FROM pg_constraint constraint_row JOIN pg_class relation ON relation.oid=constraint_row.conrelid
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname IN ('prefunded_card', 'piggyvest_savings_ledger')),
  'indexes', (SELECT jsonb_agg(jsonb_build_object('table', relation.relname,
      'name', index_relation.relname,
      'definitionSha256', encode(sha256(convert_to(pg_get_indexdef(index_row.indexrelid), 'UTF8')), 'hex'))
      ORDER BY relation.relname, index_relation.relname)
    FROM pg_index index_row JOIN pg_class relation ON relation.oid=index_row.indrelid
    JOIN pg_class index_relation ON index_relation.oid=index_row.indexrelid
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname IN ('prefunded_card', 'piggyvest_savings_ledger'))
);
ROLLBACK;
