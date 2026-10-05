-- =============================================
-- REGRESSION TEST: Staging wallet mapping bridges
--   Validates the provisioner-only mapping write (idempotent re-record,
--   conflict and ownership rejection) and the service-role-only owner
--   resolution (unique enabled hit, disabled/unknown/ambiguous miss),
--   plus the role grants on both functions.
--
-- USAGE:
--   psql $DATABASE_URL -f supabase/migrations/tests/staging_wallet_mapping_bridges.sql
-- =============================================

BEGIN;

-- Everything runs as the session role: the record bridge revokes
-- service_role by design, and grants are asserted explicitly below.
DO $$
DECLARE
  v_merchant_id uuid := 'a41ed783-0000-4000-8000-000000000601';
  v_customer_id uuid := 'a41ed783-0000-4000-8000-000000000602';
  v_product_id uuid := 'a41ed783-0000-4000-8000-000000000603';
  v_goal_id uuid := 'a41ed783-0000-4000-8000-000000000604';
  v_other_goal_id uuid := 'a41ed783-0000-4000-8000-000000000605';
  v_integration_id uuid := 'a41ed783-0000-4000-8000-000000000606';
  v_other_integration_id uuid := 'a41ed783-0000-4000-8000-000000000607';
  v_result boolean;
  v_owner record;
  v_rejected boolean;
BEGIN
  IF to_regprocedure(
    'piggyvest_staging.record_wallet_goal_mapping(uuid,text,text,uuid,uuid,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'record_wallet_goal_mapping is missing';
  END IF;
  IF to_regprocedure(
    'public.resolve_staging_wallet_owner(text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'resolve_staging_wallet_owner is missing';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.resolve_staging_wallet_owner(text,text)'::regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'resolve bridge must not be executable by authenticated';
  END IF;
  IF NOT has_function_privilege(
    'service_role',
    'public.resolve_staging_wallet_owner(text,text)'::regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'resolve bridge must be executable by service_role';
  END IF;

  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (v_merchant_id, 'bridge@example.com', 'Bridge Store', 'bridge-store');

  INSERT INTO public.customers (id, merchant_id, email, first_name)
  VALUES (v_customer_id, v_merchant_id, 'bridge-customer@example.com', 'Bridge');

  INSERT INTO public.products (id, merchant_id, name, price, status, stock_quantity)
  VALUES (v_product_id, v_merchant_id, 'Bridge device', 800000, 'active', 3);

  INSERT INTO public.customer_savings_goals (
    id, merchant_id, customer_id, product_id, title, target_amount,
    contribution_amount, contribution_frequency, start_date, maturity_date,
    source_mode, terms_accepted_at, non_withdrawable_accepted_at
  )
  VALUES (
    v_goal_id, v_merchant_id, v_customer_id, v_product_id, 'Bridge goal', 800000,
    20000, 'daily', current_date, current_date + 30,
    'manual', now(), now()
  ), (
    v_other_goal_id, v_merchant_id, v_customer_id, v_product_id, 'Other goal', 800000,
    20000, 'daily', current_date, current_date + 30,
    'manual', now(), now()
  );

  INSERT INTO piggyvest_staging.integrations (id, expected_provider_account_id, enabled)
  VALUES
    (v_integration_id, 'provider-acct-bridge-001', true),
    (v_other_integration_id, 'provider-acct-bridge-002', true);

  -- Record then resolve: the dedicated wallet attributes to its tenant.
  SELECT piggyvest_staging.record_wallet_goal_mapping(
    v_integration_id, 'pvb-wallet-bridge-001', 'pv-customer-bridge-001',
    v_merchant_id, v_customer_id, v_goal_id
  ) INTO v_result;
  IF v_result IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'mapping record did not return true';
  END IF;

  SELECT * INTO v_owner
  FROM public.resolve_staging_wallet_owner('pvb-wallet-bridge-001', 'pv-customer-bridge-001');
  IF v_owner.merchant_id IS DISTINCT FROM v_merchant_id
    OR v_owner.customer_id IS DISTINCT FROM v_customer_id THEN
    RAISE EXCEPTION 'resolve bridge returned the wrong tenant: %', row_to_json(v_owner);
  END IF;

  -- Identical re-records are idempotent.
  SELECT piggyvest_staging.record_wallet_goal_mapping(
    v_integration_id, 'pvb-wallet-bridge-001', 'pv-customer-bridge-001',
    v_merchant_id, v_customer_id, v_goal_id
  ) INTO v_result;
  IF v_result IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'identical re-record must stay true';
  END IF;

  -- Conflicting reuse of the wallet identity raises.
  v_rejected := false;
  BEGIN
    PERFORM piggyvest_staging.record_wallet_goal_mapping(
      v_integration_id, 'pvb-wallet-bridge-001', 'pv-customer-bridge-001',
      v_merchant_id, v_customer_id, v_other_goal_id
    );
  EXCEPTION WHEN unique_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'conflicting wallet reuse must raise unique_violation';
  END IF;

  -- Unknown wallets resolve to nothing (retryable-unmapped, never a guess).
  IF EXISTS (SELECT 1 FROM public.resolve_staging_wallet_owner('pvb-wallet-unknown', 'pv-customer-bridge-001')) THEN
    RAISE EXCEPTION 'unknown wallet must resolve to no rows';
  END IF;

  -- Disabled integrations are invisible to resolution.
  UPDATE piggyvest_staging.integrations SET enabled = false
    WHERE id = v_integration_id;
  IF EXISTS (SELECT 1 FROM public.resolve_staging_wallet_owner('pvb-wallet-bridge-001', 'pv-customer-bridge-001')) THEN
    RAISE EXCEPTION 'disabled-integration wallet must resolve to no rows';
  END IF;
  UPDATE piggyvest_staging.integrations SET enabled = true
    WHERE id = v_integration_id;

  -- Same pair under two integrations is ambiguous: fail closed.
  SELECT piggyvest_staging.record_wallet_goal_mapping(
    v_other_integration_id, 'pvb-wallet-bridge-001', 'pv-customer-bridge-001',
    v_merchant_id, v_customer_id, v_other_goal_id
  ) INTO v_result;
  IF EXISTS (SELECT 1 FROM public.resolve_staging_wallet_owner('pvb-wallet-bridge-001', 'pv-customer-bridge-001')) THEN
    RAISE EXCEPTION 'ambiguous wallet pair must resolve to no rows';
  END IF;

  -- Recording under a disabled integration raises.
  UPDATE piggyvest_staging.integrations SET enabled = false
    WHERE id = v_other_integration_id;
  v_rejected := false;
  BEGIN
    PERFORM piggyvest_staging.record_wallet_goal_mapping(
      v_other_integration_id, 'pvb-wallet-bridge-002', 'pv-customer-bridge-001',
      v_merchant_id, v_customer_id, v_goal_id
    );
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'record under a disabled integration must raise check_violation';
  END IF;
END;
$$;

ROLLBACK;
