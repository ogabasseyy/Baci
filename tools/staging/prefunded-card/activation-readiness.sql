BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5000ms';
SET LOCAL lock_timeout = '1000ms';
DO $$ BEGIN
  IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system())
      IS DISTINCT FROM '7685292944002592802' THEN
    RAISE EXCEPTION 'staging_identity_refused';
  END IF;
END $$;
SELECT pg_catalog.json_build_object(
  'systemIdentifier', (SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
  'readOnly', current_setting('transaction_read_only') = 'on',
  'sslEnabled', current_setting('ssl') = 'on',
  'listenAddresses', current_setting('listen_addresses'),
  'databasePort', current_setting('port')::integer,
  'sslCertificatePath', current_setting('ssl_cert_file'),
  'sslKeyPath', current_setting('ssl_key_file'),
  'roles', (SELECT coalesce(json_agg(json_build_object(
    'name', rolname, 'loginEnabled', rolcanlogin,
    'unsafe', rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication
  ) ORDER BY rolname), '[]'::json) FROM pg_catalog.pg_roles
    WHERE rolname IN ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence')),
  'registry', (SELECT coalesce(json_agg(json_build_object(
    'id', id, 'businessId', expected_provider_account_id, 'enabled', enabled
  )), '[]'::json) FROM piggyvest_staging.integrations
    WHERE id = 'd91d9e87-8e0d-44de-9b84-1e1d709633d2'),
  'goals', (SELECT coalesce(json_agg(json_build_object(
    'goalId', goal.id, 'status', goal.status, 'sourceMode', goal.source_mode,
    'currentAmountNaira', goal.current_amount, 'targetAmountNaira', goal.target_amount,
    'providerWalletId', mapping.provider_wallet_id,
    'providerCustomerId', mapping.provider_customer_id,
    'canonicalLogin', binding.authorized_login, 'canonicalEnabled', binding.enabled,
    'canonicalPrincipalKobo', (SELECT coalesce(sum(posting.amount_kobo), 0)
      FROM piggyvest_savings_ledger.postings posting
      JOIN piggyvest_savings_ledger.operations operation ON operation.id = posting.operation_id
      WHERE operation.integration_id = mapping.integration_id AND operation.goal_id = goal.id
        AND posting.account = 'principal'),
    'prefundedEnrolled', route.goal_id IS NOT NULL
  ) ORDER BY goal.id), '[]'::json)
    FROM piggyvest_staging.wallet_goal_mappings mapping
    JOIN public.customer_savings_goals goal ON goal.id = mapping.goal_id
      AND goal.merchant_id = mapping.merchant_id AND goal.customer_id = mapping.customer_id
    LEFT JOIN piggyvest_savings_ledger.bindings binding ON binding.goal_id = goal.id
      AND binding.integration_id = mapping.integration_id AND binding.merchant_id = mapping.merchant_id
      AND binding.customer_id = mapping.customer_id
    LEFT JOIN prefunded_card.credit_routes route ON route.goal_id = goal.id
    WHERE mapping.integration_id = 'd91d9e87-8e0d-44de-9b84-1e1d709633d2'
      AND mapping.merchant_id = '10000000-0000-4000-8000-000000000001'
      AND mapping.customer_id = '10000000-0000-4000-8000-000000000002'),
  'treasuryBindings', (SELECT count(*) FROM prefunded_card.treasury_bindings),
  'evidenceAuthorities', (SELECT count(*) FROM prefunded_card.evidence_authorities),
  'operations', (SELECT count(*) FROM prefunded_card.operations),
  'checkoutIntents', (SELECT count(*) FROM prefunded_card.checkout_intents)
);
ROLLBACK;
