BEGIN;

CREATE OR REPLACE FUNCTION public.allocate_customer_savings_contribution(
  p_goal_id uuid, p_customer_id uuid, p_merchant_id uuid,
  p_amount numeric, p_source_type text, p_source_id uuid,
  p_idempotency_key text, p_description text DEFAULT NULL
) RETURNS TABLE(
  success boolean, goal_current_amount numeric, wallet_balance numeric,
  contribution_id uuid, wallet_transaction_id uuid, goal_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_wallet_id uuid;
  v_current_wallet_balance numeric;
  v_new_wallet_balance numeric;
  v_contribution_id uuid;
  v_wallet_transaction_id uuid;
  v_existing_contribution record;
  v_goal record;
  v_new_goal_amount numeric;
  v_new_goal_status text;
  v_request_fingerprint jsonb;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'allocate_customer_savings_contribution p_amount must be greater than zero'
      USING ERRCODE = '22023';
  END IF;

  IF p_goal_id IS NULL THEN
    RAISE EXCEPTION 'allocate_customer_savings_contribution p_goal_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'allocate_customer_savings_contribution p_customer_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'allocate_customer_savings_contribution p_merchant_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'allocate_customer_savings_contribution p_idempotency_key is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_source_type NOT IN ('wallet', 'paystack_authorization') THEN
    RAISE EXCEPTION 'unsupported_savings_contribution_source_type'
      USING ERRCODE = '22023';
  END IF;

  IF p_source_type = 'paystack_authorization' AND p_source_id IS NULL THEN
    RAISE EXCEPTION 'paystack_authorization_source_id_required'
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
    FROM public.customers c
    WHERE c.id = p_customer_id
      AND c.merchant_id = p_merchant_id
  ) THEN
    RAISE EXCEPTION 'customer_not_found_for_merchant'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'customer_savings_contribution:' || p_idempotency_key,
      0
    )
  );

  v_request_fingerprint := jsonb_build_object(
    'goalId', p_goal_id,
    'customerId', p_customer_id,
    'merchantId', p_merchant_id,
    'amount', p_amount,
    'sourceType', p_source_type,
    'sourceId', p_source_id
  );

  SELECT c.*
  INTO v_existing_contribution
  FROM public.customer_savings_contributions c
  WHERE c.merchant_id = p_merchant_id
    AND c.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_existing_contribution.id IS NOT NULL THEN
    IF v_existing_contribution.status = 'completed' THEN
      IF v_existing_contribution.metadata->'request_fingerprint' IS DISTINCT FROM v_request_fingerprint THEN
        RAISE EXCEPTION 'duplicate_savings_contribution_idempotency_key'
          USING ERRCODE = 'P0001';
      END IF;

      SELECT g.current_amount, g.status, COALESCE(w.available_balance, 0)
      INTO v_new_goal_amount, v_new_goal_status, v_new_wallet_balance
      FROM public.customer_savings_goals g
      LEFT JOIN public.customer_wallets w
        ON w.customer_id = g.customer_id
       AND w.merchant_id = g.merchant_id
      WHERE g.id = v_existing_contribution.goal_id;

      RETURN QUERY
      SELECT
        true,
        v_new_goal_amount,
        v_new_wallet_balance,
        v_existing_contribution.id,
        v_existing_contribution.wallet_transaction_id,
        v_new_goal_status;
      RETURN;
    END IF;

    IF v_existing_contribution.status IN ('pending', 'processing')
      AND v_existing_contribution.source_type = 'paystack_authorization'
      AND p_source_type = 'paystack_authorization'
      AND v_existing_contribution.transaction_id = p_source_id
      AND v_existing_contribution.metadata->'request_fingerprint' = v_request_fingerprint
    THEN
      v_contribution_id := v_existing_contribution.id;
    ELSE
      RAISE EXCEPTION 'duplicate_savings_contribution_idempotency_key'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_contribution_id := gen_random_uuid();
  END IF;

  SELECT g.*
  INTO v_goal
  FROM public.customer_savings_goals g
  WHERE g.id = p_goal_id
    AND g.customer_id = p_customer_id
    AND g.merchant_id = p_merchant_id
  FOR UPDATE;

  IF v_goal.id IS NULL THEN
    RAISE EXCEPTION 'savings_goal_not_found'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_goal.status NOT IN ('active', 'paused') THEN
    RAISE EXCEPTION 'savings_goal_not_allocatable'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_amount * 100 > piggyvest_savings_ledger.remaining_goal_kobo(
    v_goal.id, v_goal.merchant_id, v_goal.customer_id, v_goal.target_amount, v_goal.current_amount) THEN
    RAISE EXCEPTION 'savings_contribution_exceeds_remaining_target'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT w.id, w.available_balance
  INTO v_wallet_id, v_current_wallet_balance
  FROM public.customer_wallets w
  WHERE w.customer_id = p_customer_id
    AND w.merchant_id = p_merchant_id
  FOR UPDATE;

  IF v_wallet_id IS NULL OR COALESCE(v_current_wallet_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'insufficient_wallet_balance'
      USING ERRCODE = 'P0001';
  END IF;

  v_new_wallet_balance := v_current_wallet_balance - p_amount;

  UPDATE public.customer_wallets
  SET
    available_balance = v_new_wallet_balance,
    updated_at = now()
  WHERE id = v_wallet_id;

  INSERT INTO public.customer_wallet_transactions (
    wallet_id, customer_id, merchant_id, type, amount, balance_after,
    source_type, source_id, status, description, metadata
  )
  VALUES (
    v_wallet_id,
    p_customer_id,
    p_merchant_id,
    'redemption',
    p_amount,
    v_new_wallet_balance,
    'device_savings_contribution',
    v_contribution_id,
    'completed',
    COALESCE(p_description, 'Device savings contribution'),
    jsonb_build_object(
      'goal_id', p_goal_id,
      'idempotency_key', p_idempotency_key,
      'source_type', p_source_type
    )
  )
  RETURNING id INTO v_wallet_transaction_id;

  IF v_existing_contribution.id IS NULL THEN
    INSERT INTO public.customer_savings_contributions (
      id, goal_id, merchant_id, customer_id, wallet_transaction_id, transaction_id,
      amount, source_type, status, processed_at, idempotency_key, metadata
    )
    VALUES (
      v_contribution_id,
      p_goal_id,
      p_merchant_id,
      p_customer_id,
      v_wallet_transaction_id,
      CASE WHEN p_source_type = 'paystack_authorization' THEN p_source_id ELSE NULL END,
      p_amount,
      p_source_type,
      'completed',
      now(),
      p_idempotency_key,
      jsonb_build_object(
        'description', p_description,
        'request_fingerprint', v_request_fingerprint
      )
    );
  ELSE
    UPDATE public.customer_savings_contributions
    SET
      wallet_transaction_id = v_wallet_transaction_id,
      amount = p_amount,
      status = 'completed',
      processed_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'description', p_description,
        'request_fingerprint', v_request_fingerprint
      ),
      updated_at = now()
    WHERE id = v_contribution_id;
  END IF;

  v_new_goal_amount := v_goal.current_amount + p_amount;
  v_new_goal_status := CASE
    WHEN v_new_goal_amount >= v_goal.target_amount THEN 'completed'
    ELSE v_goal.status
  END;

  UPDATE public.customer_savings_goals AS updated_goal
  SET
    current_amount = v_new_goal_amount,
    status = v_new_goal_status,
    completed_at = CASE
      WHEN v_new_goal_status = 'completed' AND completed_at IS NULL THEN now()
      ELSE completed_at
    END,
    updated_at = now()
  WHERE id = p_goal_id
  RETURNING updated_goal.current_amount, updated_goal.status
  INTO v_new_goal_amount, v_new_goal_status;

  PERFORM piggyvest_savings_ledger.record_contribution_events(
    p_goal_id, p_merchant_id, p_customer_id, 'customer',
    jsonb_build_object('amount', p_amount, 'contribution_id', v_contribution_id,
      'wallet_transaction_id', v_wallet_transaction_id, 'idempotency_key', p_idempotency_key), v_new_goal_amount, v_goal.status, v_new_goal_status);

  RETURN QUERY
  SELECT
    true,
    v_new_goal_amount,
    v_new_wallet_balance,
    v_contribution_id,
    v_wallet_transaction_id,
    v_new_goal_status;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_customer_savings_contribution(
  uuid, uuid, uuid, numeric, text, uuid, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_customer_savings_contribution(
  uuid, uuid, uuid, numeric, text, uuid, text, text
) TO authenticated, service_role;

COMMIT;
