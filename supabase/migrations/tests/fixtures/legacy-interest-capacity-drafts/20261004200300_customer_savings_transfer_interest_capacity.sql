BEGIN;

CREATE OR REPLACE FUNCTION public.allocate_plan_transfer_contribution(
  p_customer_id uuid,
  p_merchant_id uuid,
  p_amount_kobo bigint,
  p_provider_transaction_id text,
  p_idempotency_key text,
  p_provider_wallet_id text DEFAULT NULL,
  p_provider_customer_id text DEFAULT NULL
)
RETURNS TABLE (
  success boolean,
  outcome text,
  contribution_id uuid,
  goal_id uuid,
  projected_amount numeric,
  goal_current_amount numeric,
  goal_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_lock bigint;
  v_existing public.customer_savings_contributions%ROWTYPE;
  v_goal_ids uuid[];
  v_mapped_goal_ids uuid[];
  v_goal public.customer_savings_goals%ROWTYPE;
  v_amount numeric(12, 2);
  v_projected numeric(12, 2);
  v_new_goal_amount numeric(12, 2);
  v_new_goal_status text;
  v_contribution_id uuid;
  v_existing_current numeric(12, 2);
  v_existing_status text;
  v_projection_source text := 'single_allocatable_manual_goal';
BEGIN
  IF p_customer_id IS NULL
    OR p_merchant_id IS NULL
    OR p_amount_kobo IS NULL
    OR p_amount_kobo <= 0
    OR p_provider_transaction_id IS NULL
    OR length(trim(p_provider_transaction_id)) = 0
    OR p_idempotency_key IS NULL
    OR length(trim(p_idempotency_key)) = 0
  THEN
    RAISE EXCEPTION 'plan transfer allocation requires a customer, merchant, positive amount, provider transaction, and idempotency key'
      USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(
    ('x' || left(md5('plan-transfer:' || p_idempotency_key), 15))::bit(60)::bigint,
    0
  )
  INTO v_lock;
  PERFORM pg_advisory_xact_lock(v_lock);

  SELECT * INTO v_existing
  FROM public.customer_savings_contributions
  WHERE merchant_id = p_merchant_id
    AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.source_type <> 'plan_account_transfer'
      OR v_existing.customer_id <> p_customer_id
      OR COALESCE(
        v_existing.metadata->>'fingerprint',
        v_existing.idempotency_key
      ) <> p_provider_transaction_id
      OR v_existing.status <> 'completed'
    THEN
      RAISE EXCEPTION 'plan transfer idempotency key already used by a different contribution'
        USING ERRCODE = '23505';
    END IF;
    SELECT g.current_amount, g.status
      INTO v_existing_current, v_existing_status
      FROM public.customer_savings_goals g
      WHERE g.id = v_existing.goal_id;
    RETURN QUERY
    SELECT
      true,
      'replayed'::text,
      v_existing.id,
      v_existing.goal_id,
      v_existing.amount,
      v_existing_current,
      v_existing_status;
    RETURN;
  END IF;
  IF p_provider_wallet_id IS NOT NULL
    AND p_provider_customer_id IS NOT NULL
    AND length(trim(p_provider_wallet_id)) > 0
    AND length(trim(p_provider_customer_id)) > 0
  THEN
    SELECT array_agg(DISTINCT mapping.goal_id)
      INTO v_mapped_goal_ids
      FROM piggyvest_staging.wallet_goal_mappings AS mapping
      JOIN piggyvest_staging.integrations AS registry
        ON registry.id = mapping.integration_id AND registry.enabled
      WHERE mapping.provider_wallet_id = p_provider_wallet_id
        AND mapping.provider_customer_id = p_provider_customer_id
        AND mapping.merchant_id = p_merchant_id
        AND mapping.customer_id = p_customer_id;
    IF v_mapped_goal_ids IS NOT NULL AND cardinality(v_mapped_goal_ids) > 1 THEN
      RAISE EXCEPTION 'plan transfer destination maps to % goals; no unique attribution target', cardinality(v_mapped_goal_ids)
        USING ERRCODE = 'P0001';
    END IF;
    IF v_mapped_goal_ids IS NOT NULL AND cardinality(v_mapped_goal_ids) = 1 THEN
      SELECT * INTO v_goal
      FROM public.customer_savings_goals g
      WHERE g.id = v_mapped_goal_ids[1]
        AND g.customer_id = p_customer_id
        AND g.merchant_id = p_merchant_id
        AND g.status = ANY (ARRAY['active', 'paused']::text[])
        AND g.source_mode = 'manual'
        AND piggyvest_savings_ledger.remaining_goal_kobo(
          g.id, g.merchant_id, g.customer_id, g.target_amount, g.current_amount) > 0
      FOR UPDATE;
      IF NOT FOUND THEN
        RETURN QUERY
        SELECT
          false,
          'mapped_goal_unallocatable'::text,
          NULL::uuid,
          v_mapped_goal_ids[1],
          NULL::numeric,
          NULL::numeric,
          NULL::text;
        RETURN;
      END IF;
      v_goal_ids := v_mapped_goal_ids;
      v_projection_source := 'mapped_wallet_goal';
    END IF;
  END IF;
  IF v_goal_ids IS NULL THEN
    WITH candidates AS (
      SELECT g.id
      FROM public.customer_savings_goals g
      WHERE g.customer_id = p_customer_id
        AND g.merchant_id = p_merchant_id
        AND g.status = ANY (ARRAY['active', 'paused']::text[])
        AND g.source_mode = 'manual'
        AND piggyvest_savings_ledger.remaining_goal_kobo(
          g.id, g.merchant_id, g.customer_id, g.target_amount, g.current_amount) > 0
      ORDER BY g.created_at, g.id
      FOR UPDATE
    )
    SELECT array_agg(id)
      INTO v_goal_ids
      FROM candidates;

    IF v_goal_ids IS NULL OR cardinality(v_goal_ids) = 0 THEN
      RETURN QUERY
      SELECT
        false,
        'no_allocatable_goal'::text,
        NULL::uuid,
        NULL::uuid,
        NULL::numeric,
        NULL::numeric,
        NULL::text;
      RETURN;
    END IF;

    IF cardinality(v_goal_ids) > 1 THEN
      RAISE EXCEPTION 'plan transfer matches % goals; no unique attribution target', cardinality(v_goal_ids)
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_goal
    FROM public.customer_savings_goals
    WHERE id = v_goal_ids[1];
  END IF;

  v_amount := (p_amount_kobo::numeric / 100)::numeric(12, 2);
  IF v_amount * 100 > piggyvest_savings_ledger.remaining_goal_kobo(
    v_goal.id, v_goal.merchant_id, v_goal.customer_id, v_goal.target_amount, v_goal.current_amount) THEN
    RAISE EXCEPTION 'plan transfer exceeds remaining goal amount; reconciliation required'
      USING ERRCODE = 'P0001';
  END IF;
  v_projected := v_amount;
  v_new_goal_amount := v_goal.current_amount + v_projected;
  v_new_goal_status :=
    CASE WHEN v_new_goal_amount >= v_goal.target_amount
      THEN 'completed'
      ELSE v_goal.status
    END;

  INSERT INTO public.customer_savings_contributions (
    goal_id,
    merchant_id,
    customer_id,
    amount,
    source_type,
    status,
    processed_at,
    idempotency_key,
    metadata
  )
  VALUES (
    v_goal.id,
    p_merchant_id,
    p_customer_id,
    v_projected,
    'plan_account_transfer',
    'completed',
    now(),
    p_idempotency_key,
    jsonb_build_object(
      'fingerprint', p_provider_transaction_id,
      'provider_transaction_id', p_provider_transaction_id,
      'received_amount_kobo', p_amount_kobo,
      'received_amount', v_amount::text,
      'projection', v_projection_source
    )
  )
  RETURNING id INTO v_contribution_id;

  UPDATE public.customer_savings_goals AS updated_goal
  SET
    current_amount = v_new_goal_amount,
    status = v_new_goal_status,
    completed_at = CASE
      WHEN v_new_goal_status = 'completed' AND v_goal.status <> 'completed'
        THEN now()
      ELSE completed_at
    END,
    updated_at = now()
  WHERE id = v_goal.id
  RETURNING updated_goal.current_amount, updated_goal.status
  INTO v_new_goal_amount, v_new_goal_status;

  PERFORM piggyvest_savings_ledger.record_contribution_events(
    v_goal.id, p_merchant_id, p_customer_id, 'system',
    jsonb_build_object('amount', v_projected, 'contribution_id', v_contribution_id,
      'source_type', 'plan_account_transfer', 'provider_transaction_id', p_provider_transaction_id,
      'idempotency_key', p_idempotency_key), v_new_goal_amount, v_goal.status, v_new_goal_status);

  RETURN QUERY
  SELECT
    true,
    'projected'::text,
    v_contribution_id,
    v_goal.id,
    v_projected,
    v_new_goal_amount,
    v_new_goal_status;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_plan_transfer_contribution(uuid, uuid, bigint, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_plan_transfer_contribution(uuid, uuid, bigint, text, text, text, text)
  TO service_role;

COMMIT;

