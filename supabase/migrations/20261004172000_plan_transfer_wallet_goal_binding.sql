-- Bind plan-transfer projection to the destination account's mapped goal.
--
-- The funding flow provisions one wallet per savings goal and records the
-- binding in piggyvest_staging.wallet_goal_mappings, but the projection RPC
-- inferred the target from the customer's allocatable-goal census. With two
-- allocatable manual goals every delivery raised ambiguity even though the
-- destination account identifies one goal — and if the intended goal stopped
-- being allocatable while another remained, the census credited the wrong
-- goal.
--
-- The RPC now takes the destination (provider wallet, customer) pair. When
-- exactly one enabled mapping binds that pair, the mapped goal is locked
-- and validated as the exclusive target; a mapped-but-unallocatable goal
-- returns a definitive skip (redelivery cannot fix a completed goal, and
-- the inflow-credit audit row preserves the trail). Zero mappings falls
-- back to the single-candidate census (production wallets predate the
-- staging mapping table); mappings to distinct goals raise retryable
-- ambiguity.
--
-- The 5-argument overload is dropped: keeping it would leave a
-- census-only entry point beside the bound one. Grants are reset so only
-- the webhook worker role executes the new overload.

DROP FUNCTION IF EXISTS public.allocate_plan_transfer_contribution(uuid, uuid, bigint, text, text);

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

  -- Same advisory-lock shape as the wallet allocation RPC: one inserter
  -- per idempotency key, so concurrent redeliveries serialize instead of
  -- double-projecting.
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

  -- Exact destination binding first: the funding flow records one wallet
  -- per goal, so the destination pair identifies the intended goal even
  -- when several goals are allocatable. Only enabled integrations with
  -- matching local ownership count; anything else falls through to the
  -- census below.
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
        AND g.current_amount < g.target_amount
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

  -- Lock every allocatable candidate up front so the uniqueness census
  -- cannot change between the count and the insert. The CTE takes the
  -- row locks (FOR UPDATE is illegal with an aggregate, so the
  -- aggregation happens outside the locked select).
  IF v_goal_ids IS NULL THEN
    WITH candidates AS (
      SELECT g.id
      FROM public.customer_savings_goals g
      WHERE g.customer_id = p_customer_id
        AND g.merchant_id = p_merchant_id
        AND g.status = ANY (ARRAY['active', 'paused']::text[])
        AND g.source_mode = 'manual'
        AND g.current_amount < g.target_amount
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
  v_projected := LEAST(v_amount, v_goal.target_amount - v_goal.current_amount);
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

  UPDATE public.customer_savings_goals
  SET
    current_amount = v_new_goal_amount,
    status = v_new_goal_status,
    completed_at = CASE
      WHEN v_new_goal_status = 'completed' AND v_goal.status <> 'completed'
        THEN now()
      ELSE completed_at
    END,
    updated_at = now()
  WHERE id = v_goal.id;

  INSERT INTO public.customer_savings_events (
    goal_id,
    merchant_id,
    customer_id,
    event_type,
    actor_type,
    metadata
  ) VALUES (
    v_goal.id,
    p_merchant_id,
    p_customer_id,
    'contribution_completed',
    'system',
    jsonb_build_object(
      'amount', v_projected,
      'contribution_id', v_contribution_id,
      'source_type', 'plan_account_transfer',
      'provider_transaction_id', p_provider_transaction_id,
      'idempotency_key', p_idempotency_key
    )
  );

  IF v_new_goal_status = 'completed' AND v_goal.status <> 'completed' THEN
    INSERT INTO public.customer_savings_events (
      goal_id,
      merchant_id,
      customer_id,
      event_type,
      actor_type,
      metadata
    )
    VALUES (
      v_goal.id,
      p_merchant_id,
      p_customer_id,
      'goal_completed',
      'system',
      jsonb_build_object('current_amount', v_new_goal_amount)
    );
  END IF;

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
