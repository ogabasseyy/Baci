CREATE FUNCTION pg_temp.enrollment_check() RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  PERFORM pg_temp.enrollment_identity();
  IF NOT EXISTS(SELECT 1 FROM public.customer_savings_goals goal
    JOIN public.customers customer ON customer.id=goal.customer_id AND customer.merchant_id=goal.merchant_id
    JOIN auth.users actor ON actor.id=customer.user_id
    JOIN piggyvest_staging.wallet_goal_mappings mapping ON mapping.goal_id=goal.id
    JOIN piggyvest_savings_ledger.bindings binding ON binding.goal_id=goal.id
    JOIN piggyvest_staging.integrations integration ON integration.id=mapping.integration_id
    WHERE goal.id='9f01153c-1589-4dde-b9aa-8f644a846832'
      AND goal.merchant_id='10000000-0000-4000-8000-000000000001'
      AND goal.customer_id='10000000-0000-4000-8000-000000000002'
      AND customer.user_id='baeb4f5a-54c7-4d46-8b07-9e69ab2907b3'
      AND customer.deleted_at IS NULL AND actor.deleted_at IS NULL
      AND goal.current_amount=0 AND goal.initial_contribution_amount=0
      AND goal.goal_kind='legacy' AND goal.source_mode='manual' AND goal.status='active'
      AND goal.completed_at IS NULL AND goal.cancelled_at IS NULL AND goal.spent_at IS NULL
      AND goal.metadata->>'stagingTestPlanKey'='pvb-empty-interest-staging-20261002-v1'
      AND goal.metadata->'interestOptIn'='true'::jsonb AND goal.metadata->'prefundingKobo'='0'::jsonb
      AND mapping.integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'
      AND mapping.merchant_id=goal.merchant_id AND mapping.customer_id=goal.customer_id
      AND mapping.provider_wallet_id='01M3W0Y93XHJY9RPQ2G75X81WG'
      AND mapping.provider_customer_id='c096507d-dc32-45d2-9c01-871a27abfd10'
      AND binding.integration_id=mapping.integration_id AND binding.merchant_id=goal.merchant_id
      AND binding.customer_id=goal.customer_id AND binding.enabled
      AND binding.authorized_login='prefunded_treasury_operator'
      AND integration.enabled AND integration.expected_provider_account_id='01M2381RG34HQJMHQKE7DWDACR')
    OR (SELECT count(*) FROM piggyvest_staging.wallet_goal_mappings
      WHERE goal_id='9f01153c-1589-4dde-b9aa-8f644a846832'
        OR provider_wallet_id='01M3W0Y93XHJY9RPQ2G75X81WG')<>1
    OR (SELECT count(*) FROM piggyvest_savings_ledger.bindings
      WHERE goal_id='9f01153c-1589-4dde-b9aa-8f644a846832')<>1 THEN
    RAISE EXCEPTION 'empty enrollment goal or exact binding refused';
  END IF;
  IF EXISTS(SELECT 1 FROM public.customer_savings_contributions WHERE goal_id='9f01153c-1589-4dde-b9aa-8f644a846832')
    OR EXISTS(SELECT 1 FROM piggyvest_staging.goal_inflow_projections WHERE goal_id='9f01153c-1589-4dde-b9aa-8f644a846832')
    OR EXISTS(SELECT 1 FROM piggyvest_savings_ledger.operations WHERE goal_id='9f01153c-1589-4dde-b9aa-8f644a846832')
    OR EXISTS(SELECT 1 FROM prefunded_card.operations WHERE goal_id='9f01153c-1589-4dde-b9aa-8f644a846832')
    OR EXISTS(SELECT 1 FROM prefunded_card.bank_projections WHERE goal_id='9f01153c-1589-4dde-b9aa-8f644a846832')
    OR EXISTS(SELECT 1 FROM prefunded_card.checkout_intents WHERE goal_id='9f01153c-1589-4dde-b9aa-8f644a846832')
    OR EXISTS(SELECT 1 FROM piggyvest_savings_ledger.interest_policies WHERE goal_id='9f01153c-1589-4dde-b9aa-8f644a846832')
    OR EXISTS(SELECT 1 FROM public.piggyvest_inflow_credits
      WHERE wallet_id IN ('01M3W0Y93XHJY9RPQ2G75X81WG','01M3W0YENHMFJ8Z9FS76E3CC6T'))
    OR EXISTS(SELECT 1 FROM prefunded_card.provider_evidence
      WHERE observation->>'destinationWalletId' IN ('01M3W0Y93XHJY9RPQ2G75X81WG','01M3W0YENHMFJ8Z9FS76E3CC6T')) THEN
    RAISE EXCEPTION 'empty enrollment financial history or policy present';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.customer_savings_goals
      WHERE id='430314fd-cd8b-4579-98d4-e9f345713dd6' AND current_amount*100=10000
        AND merchant_id='10000000-0000-4000-8000-000000000001'
      AND customer_id='10000000-0000-4000-8000-000000000002')
    OR NOT EXISTS(SELECT 1 FROM piggyvest_staging.wallet_goal_mappings
      WHERE goal_id='430314fd-cd8b-4579-98d4-e9f345713dd6'
        AND integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'
        AND merchant_id='10000000-0000-4000-8000-000000000001'
        AND customer_id='10000000-0000-4000-8000-000000000002'
        AND provider_wallet_id='01M3CQX27G9687EFSF1TKYMPR9'
        AND provider_customer_id='c096507d-dc32-45d2-9c01-871a27abfd10')
    OR NOT EXISTS(SELECT 1 FROM prefunded_card.treasury_bindings treasury
      JOIN prefunded_card.treasury_identities identity ON identity.treasury_binding_id=treasury.id
      WHERE treasury.id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57'
        AND treasury.integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'
        AND treasury.merchant_id='10000000-0000-4000-8000-000000000001'
        AND treasury.expected_business_id='01M2381RG34HQJMHQKE7DWDACR'
        AND treasury.source_wallet_id='01M238A0V75387H4HZ15YFWGX3' AND treasury.currency='NGN'
        AND treasury.authorized_login='prefunded_treasury_operator' AND treasury.enabled
        AND treasury.verified_available_kobo=10000 AND treasury.reserved_kobo=0 AND treasury.consumed_kobo=0
        AND identity.integration_id=treasury.integration_id AND identity.merchant_id=treasury.merchant_id
        AND identity.expected_business_id=treasury.expected_business_id
        AND identity.source_wallet_id=treasury.source_wallet_id AND identity.authorized_login=treasury.authorized_login
        AND identity.opening_available_kobo=10000)
    OR (SELECT coalesce(sum(opening_available_kobo),0) FROM prefunded_card.treasury_identities)
      +(SELECT coalesce(sum(amount_kobo),0) FROM prefunded_card.treasury_replenishments)<>10000
    OR EXISTS(SELECT 1 FROM piggyvest_staging.wallet_goal_mappings WHERE provider_wallet_id='01M238A0V75387H4HZ15YFWGX3') THEN
    RAISE EXCEPTION 'empty enrollment historical goal or shared budget refused';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='prefunded_treasury_operator'
      AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls
      AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
      AND rolvaliduntil='2026-10-06T15:59:10Z'::timestamptz) THEN
    RAISE EXCEPTION 'empty enrollment restricted role refused';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM prefunded_card.evidence_authorities
    WHERE integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'
      AND business_id='01M2381RG34HQJMHQKE7DWDACR' AND system_identifier='7685292944002592802'
      AND ingestion_login='prefunded_evidence' AND reader_login='prefunded_treasury_operator'
      AND currency='NGN' AND enabled) THEN
    RAISE EXCEPTION 'empty enrollment replay evidence authority refused';
  END IF;
  IF EXISTS(SELECT 1 FROM prefunded_card.credit_routes
    WHERE goal_id='9f01153c-1589-4dde-b9aa-8f644a846832' AND (
      integration_id IS DISTINCT FROM 'd91d9e87-8e0d-44de-9b84-1e1d709633d2'::uuid
      OR merchant_id IS DISTINCT FROM '10000000-0000-4000-8000-000000000001'::uuid
      OR customer_id IS DISTINCT FROM '10000000-0000-4000-8000-000000000002'::uuid
      OR system_identifier IS DISTINCT FROM '7685292944002592802'))
    OR (SELECT count(*) FROM prefunded_card.credit_routes WHERE goal_id='9f01153c-1589-4dde-b9aa-8f644a846832')>1 THEN
    RAISE EXCEPTION 'empty enrollment existing route conflict';
  END IF;
END $$;
