-- Block device swaps while a primary savings transfer is pending.
-- See the inline guard note for the capacity race this closes.
-- Allow customers to retarget an active device savings goal to another device
-- without moving money out of the non-withdrawable savings balance.

CREATE OR REPLACE FUNCTION public.swap_customer_savings_goal_device(
  p_goal_id uuid,
  p_customer_id uuid,
  p_merchant_id uuid,
  p_actor_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_title text,
  p_product_snapshot jsonb,
  p_target_amount numeric
) RETURNS TABLE(
  success boolean,
  goal_id uuid,
  current_amount numeric,
  target_amount numeric,
  goal_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_goal record;
  v_goal_status text;
BEGIN
  IF p_goal_id IS NULL THEN
    RAISE EXCEPTION 'swap_customer_savings_goal_device p_goal_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'swap_customer_savings_goal_device p_customer_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'swap_customer_savings_goal_device p_merchant_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'swap_customer_savings_goal_device p_product_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'swap_customer_savings_goal_device p_actor_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_target_amount IS NULL OR p_target_amount <= 0 THEN
    RAISE EXCEPTION 'target_amount_must_be_positive'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'authentication_required'
        USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = p_customer_id
        AND c.merchant_id = p_merchant_id
        AND c.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'not_authorized_for_customer_savings'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.merchant_id = p_merchant_id
      AND p.status = 'active'
  ) THEN
    RAISE EXCEPTION 'product_not_available_for_savings'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_variant_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.product_variants v
      WHERE v.id = p_variant_id
        AND v.product_id = p_product_id
        AND v.merchant_id = p_merchant_id
    )
  THEN
    RAISE EXCEPTION 'variant_not_available_for_savings'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_goal
  FROM public.customer_savings_goals
  WHERE id = p_goal_id
    AND customer_id = p_customer_id
    AND merchant_id = p_merchant_id
  FOR UPDATE;

  IF v_goal.id IS NULL THEN
    RAISE EXCEPTION 'savings_goal_not_found'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_goal.status NOT IN ('active', 'paused') THEN
    RAISE EXCEPTION 'savings_goal_not_swappable'
      USING ERRCODE = 'P0001';
  END IF;

  -- A swap retargets the goal from the pre-settlement balance: the new
  -- target and completion status are computed without the in-flight
  -- amount, so a later settlement either fails its capacity predicate
  -- (stranding provider funds in a dispatched operation) or lands on a
  -- target the customer no longer sees. Block while any primary savings
  -- operation is reserved or dispatched. The goal row lock is already
  -- held, and both reserve and settle take that same lock, so no
  -- transfer can sneak into flight between the check and the retarget.
  -- The message keeps the 'not_swappable' marker so the route maps it
  -- to 409 for retry after the transfer resolves.
  IF EXISTS (
    SELECT 1
    FROM piggyvest_primary.savings_operations pending
    WHERE pending.goal_id = p_goal_id AND pending.state IN ('reserved', 'dispatched')
  ) THEN
    RAISE EXCEPTION 'savings_goal_not_swappable_pending_transfer'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_target_amount < v_goal.current_amount THEN
    RAISE EXCEPTION 'target_amount_below_current_savings'
      USING ERRCODE = 'P0001';
  END IF;

  v_goal_status := CASE
    WHEN v_goal.current_amount >= p_target_amount THEN 'completed'
    ELSE v_goal.status
  END;

  UPDATE public.customer_savings_goals
  SET
    product_id = p_product_id,
    variant_id = p_variant_id,
    title = COALESCE(NULLIF(BTRIM(p_title), ''), title),
    product_snapshot = COALESCE(p_product_snapshot, '{}'::jsonb),
    target_amount = p_target_amount,
    status = v_goal_status,
    completed_at = CASE
      WHEN v_goal_status = 'completed' THEN COALESCE(completed_at, now())
      ELSE NULL
    END,
    updated_at = now()
  WHERE id = p_goal_id;

  INSERT INTO public.customer_savings_events (
    goal_id,
    merchant_id,
    customer_id,
    event_type,
    actor_type,
    actor_id,
    metadata
  )
  VALUES (
    p_goal_id,
    p_merchant_id,
    p_customer_id,
    'device_swapped',
    'customer',
    p_actor_id,
    jsonb_build_object(
      'previous_product_id', v_goal.product_id,
      'previous_variant_id', v_goal.variant_id,
      'previous_target_amount', v_goal.target_amount,
      'product_id', p_product_id,
      'variant_id', p_variant_id,
      'target_amount', p_target_amount,
      'status', v_goal_status
    )
  );

  IF v_goal_status = 'completed' THEN
    INSERT INTO public.customer_savings_events (
      goal_id,
      merchant_id,
      customer_id,
      event_type,
      actor_type,
      actor_id,
      metadata
    )
    VALUES (
      p_goal_id,
      p_merchant_id,
      p_customer_id,
      'goal_completed',
      'system',
      NULL,
      jsonb_build_object('current_amount', v_goal.current_amount)
    );
  END IF;

  RETURN QUERY
  SELECT
    true,
    p_goal_id,
    v_goal.current_amount,
    p_target_amount,
    v_goal_status;
END;
$$;

REVOKE ALL ON FUNCTION public.swap_customer_savings_goal_device(
  uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, numeric
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.swap_customer_savings_goal_device(
  uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, numeric
) TO authenticated, service_role;
