-- =============================================
-- REGRESSION TEST: Plan transfer goal projection
--   Validates single-attribution projection of verified plan-account
--   bank transfers onto savings goals: projection, overpayment
--   rejection for reconciliation, idempotent replay, fingerprint
--   mismatch rejection, ambiguity raise, no-goal skip, and grants.
--
-- USAGE:
--   psql $DATABASE_URL -f supabase/migrations/tests/plan_transfer_goal_projection.sql
-- =============================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := '9f1ed783-0000-4000-8000-000000000601';
  v_customer_id uuid := '9f1ed783-0000-4000-8000-000000000602';
  v_product_id uuid := '9f1ed783-0000-4000-8000-000000000603';
  v_goal_id uuid := '9f1ed783-0000-4000-8000-000000000604';
  v_second_goal_id uuid := '9f1ed783-0000-4000-8000-000000000605';
  v_other_customer_id uuid := '9f1ed783-0000-4000-8000-000000000606';
  v_other_goal_id uuid := '9f1ed783-0000-4000-8000-000000000607';
  v_small_product_id uuid := '9f1ed783-0000-4000-8000-000000000608';
  v_result record;
  v_count integer;
  v_source_type text;
  v_status text;
  v_current numeric;
  v_fingerprint text;
  v_rejected boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = (
      'public.allocate_plan_transfer_contribution(uuid,uuid,bigint,text,text,text,text)'
    )::regprocedure
      AND prosecdef = true
  ) THEN
    RAISE EXCEPTION 'allocate_plan_transfer_contribution must exist as SECURITY DEFINER';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(
      COALESCE(p.proacl, acldefault('f', p.proowner))
    ) acl
    WHERE p.oid = (
      'public.allocate_plan_transfer_contribution(uuid,uuid,bigint,text,text,text,text)'
    )::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'allocate_plan_transfer_contribution must not be executable by PUBLIC';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.allocate_plan_transfer_contribution(uuid,uuid,bigint,text,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'allocate_plan_transfer_contribution must not be executable by anon';
  END IF;

  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (v_merchant_id, 'plan-transfer@example.com', 'Plan Transfer Store', 'plan-transfer-store');

  INSERT INTO public.customers (id, merchant_id, email, first_name)
  VALUES
    (v_customer_id, v_merchant_id, 'plan-transfer-customer@example.com', 'Plan'),
    (v_other_customer_id, v_merchant_id, 'plan-transfer-other@example.com', 'Other');

  INSERT INTO public.products (id, merchant_id, name, price, status, stock_quantity)
  VALUES (v_product_id, v_merchant_id, 'Plan transfer device', 800000, 'active', 3);

  -- Overpayment scenario needs a goal cheaper than the transfer: its own
  -- catalogue entry at the capped headroom so the price floor holds.
  INSERT INTO public.products (id, merchant_id, name, price, status, stock_quantity)
  VALUES (v_small_product_id, v_merchant_id, 'Small goal device', 10000, 'active', 3);

  INSERT INTO public.customer_savings_goals (
    id, merchant_id, customer_id, product_id, title, target_amount,
    contribution_amount, contribution_frequency, start_date, maturity_date,
    source_mode, terms_accepted_at, non_withdrawable_accepted_at
  )
  VALUES (
    v_goal_id, v_merchant_id, v_customer_id, v_product_id, 'Plan transfer goal', 800000,
    20000, 'daily', current_date, current_date + 30,
    'manual', now(), now()
  );

  -- Single allocatable goal: the transfer projects in full.
  SELECT *
  INTO v_result
  FROM public.allocate_plan_transfer_contribution(
    v_customer_id, v_merchant_id, 1750000, 'provider-txn-plan-001', 'plan-transfer:provider-txn-plan-001'
  );

  IF v_result.success IS DISTINCT FROM true OR v_result.outcome IS DISTINCT FROM 'projected' THEN
    RAISE EXCEPTION 'single-goal transfer did not project: %', row_to_json(v_result);
  END IF;
  IF v_result.projected_amount IS DISTINCT FROM 17500::numeric THEN
    RAISE EXCEPTION 'kobo conversion wrong, got %', v_result.projected_amount;
  END IF;

  SELECT source_type, status, metadata->>'fingerprint'
  INTO v_source_type, v_status, v_fingerprint
  FROM public.customer_savings_contributions
  WHERE id = v_result.contribution_id;

  IF v_source_type IS DISTINCT FROM 'plan_account_transfer' THEN
    RAISE EXCEPTION 'projection source_type must be plan_account_transfer, got %', v_source_type;
  END IF;
  IF v_status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'projection contribution must be completed, got %', v_status;
  END IF;
  IF v_fingerprint IS DISTINCT FROM 'provider-txn-plan-001' THEN
    RAISE EXCEPTION 'projection fingerprint must be the provider transaction, got %', v_fingerprint;
  END IF;

  SELECT current_amount, status
  INTO v_current, v_status
  FROM public.customer_savings_goals
  WHERE id = v_goal_id;

  IF v_current IS DISTINCT FROM 17500::numeric THEN
    RAISE EXCEPTION 'goal was not bumped by the projection, got %', v_current;
  END IF;
  IF v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'partially funded goal must stay active, got %', v_status;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.customer_savings_events
  WHERE goal_id = v_goal_id AND event_type = 'contribution_completed' AND actor_type = 'system';
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'projection must emit one system contribution_completed event, got %', v_count;
  END IF;

  -- Replay under the same key returns the existing contribution.
  SELECT *
  INTO v_result
  FROM public.allocate_plan_transfer_contribution(
    v_customer_id, v_merchant_id, 1750000, 'provider-txn-plan-001', 'plan-transfer:provider-txn-plan-001'
  );

  IF v_result.success IS DISTINCT FROM true OR v_result.outcome IS DISTINCT FROM 'replayed' THEN
    RAISE EXCEPTION 'same-key redelivery did not replay: %', row_to_json(v_result);
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.customer_savings_contributions
  WHERE merchant_id = v_merchant_id AND idempotency_key = 'plan-transfer:provider-txn-plan-001';
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'replay must not insert a second contribution, got %', v_count;
  END IF;

  -- Key reuse with a different provider transaction is rejected.
  v_rejected := false;
  BEGIN
    PERFORM public.allocate_plan_transfer_contribution(
      v_customer_id, v_merchant_id, 1750000, 'provider-txn-plan-OTHER', 'plan-transfer:provider-txn-plan-001'
    );
  EXCEPTION WHEN unique_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'fingerprint mismatch on key reuse must raise unique_violation';
  END IF;

  -- Two allocatable goals: ambiguous, retryable.
  INSERT INTO public.customer_savings_goals (
    id, merchant_id, customer_id, product_id, title, target_amount,
    contribution_amount, contribution_frequency, start_date, maturity_date,
    source_mode, terms_accepted_at, non_withdrawable_accepted_at
  )
  VALUES (
    v_second_goal_id, v_merchant_id, v_customer_id, v_product_id, 'Second goal', 800000,
    20000, 'daily', current_date, current_date + 30,
    'manual', now(), now()
  );

  v_rejected := false;
  BEGIN
    PERFORM public.allocate_plan_transfer_contribution(
      v_customer_id, v_merchant_id, 50000, 'provider-txn-plan-002', 'plan-transfer:provider-txn-plan-002'
    );
  EXCEPTION WHEN raise_exception THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'ambiguous goals must raise for provider redelivery';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.customer_savings_contributions
  WHERE merchant_id = v_merchant_id AND idempotency_key = 'plan-transfer:provider-txn-plan-002';
  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'ambiguous transfer must not write a contribution, got %', v_count;
  END IF;

  -- No allocatable goal: definitive skip, no contribution, no raise.
  UPDATE public.customer_savings_goals
  SET current_amount = target_amount, status = 'completed'
  WHERE id IN (v_goal_id, v_second_goal_id);

  SELECT *
  INTO v_result
  FROM public.allocate_plan_transfer_contribution(
    v_customer_id, v_merchant_id, 50000, 'provider-txn-plan-003', 'plan-transfer:provider-txn-plan-003'
  );

  IF v_result.success IS DISTINCT FROM false OR v_result.outcome IS DISTINCT FROM 'no_allocatable_goal' THEN
    RAISE EXCEPTION 'goalless transfer must skip definitively: %', row_to_json(v_result);
  END IF;

  -- Overpayment: rejected for reconciliation instead of partially
  -- projecting (partial fills hide unallocated money). The Small goal's
  -- own catalogue entry keeps the price floor satisfied.
  INSERT INTO public.customer_savings_goals (
    id, merchant_id, customer_id, product_id, title, target_amount,
    contribution_amount, contribution_frequency, start_date, maturity_date,
    source_mode, terms_accepted_at, non_withdrawable_accepted_at
  )
  VALUES (
    v_other_goal_id, v_merchant_id, v_other_customer_id, v_small_product_id, 'Small goal', 10000,
    2000, 'daily', current_date, current_date + 30,
    'manual', now(), now()
  );

  v_rejected := false;
  BEGIN
    PERFORM public.allocate_plan_transfer_contribution(
      v_other_customer_id, v_merchant_id, 5000000, 'provider-txn-plan-004', 'plan-transfer:provider-txn-plan-004'
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'plan transfer exceeds remaining goal amount; reconciliation required' THEN
      RAISE;
    END IF;
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'overpayment transfer must raise for reconciliation';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.customer_savings_contributions
  WHERE merchant_id = v_merchant_id AND idempotency_key = 'plan-transfer:provider-txn-plan-004';
  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'rejected overpayment must not write a contribution, got %', v_count;
  END IF;

  -- Validation: non-positive amounts are rejected.
  v_rejected := false;
  BEGIN
    PERFORM public.allocate_plan_transfer_contribution(
      v_other_customer_id, v_merchant_id, 0, 'provider-txn-plan-005', 'plan-transfer:provider-txn-plan-005'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'zero-amount transfer must raise invalid-parameter 22023';
  END IF;
END;
$$;

ROLLBACK;
