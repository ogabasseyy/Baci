CREATE OR REPLACE FUNCTION public.recognize_piggyvest_staging_inflow(
  p_provider_transaction_id text, p_event_data_id text, p_event_id text,
  p_provider_customer_id text, p_wallet_id text, p_amount_kobo bigint,
  p_fee_kobo bigint, p_reference text, p_session_id text, p_credited_at timestamptz
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_integration_id constant uuid := 'd91d9e87-8e0d-44de-9b84-1e1d709633d2';
  v_system_identifier text;
  v_mapping record;
  v_goal record;
  v_credit record;
  v_projection record;
  v_contribution_id uuid;
  v_new_amount numeric(12,2);
  v_new_status text;
BEGIN
  IF p_provider_transaction_id IS NULL OR pg_catalog.btrim(p_provider_transaction_id) = ''
    OR pg_catalog.octet_length(p_provider_transaction_id) > 512
    OR p_event_data_id IS NULL OR pg_catalog.btrim(p_event_data_id) = ''
    OR pg_catalog.octet_length(p_event_data_id) > 512
    OR p_event_id IS NULL OR pg_catalog.btrim(p_event_id) = ''
    OR pg_catalog.octet_length(p_event_id) > 512
    OR p_provider_customer_id IS NULL OR pg_catalog.btrim(p_provider_customer_id) = ''
    OR pg_catalog.octet_length(p_provider_customer_id) > 512
    OR p_wallet_id IS NULL OR pg_catalog.btrim(p_wallet_id) = ''
    OR pg_catalog.octet_length(p_wallet_id) > 512
    OR p_amount_kobo IS NULL OR p_amount_kobo <= 0
    OR p_fee_kobo IS NULL OR p_fee_kobo < 0
    OR p_reference IS NULL OR pg_catalog.btrim(p_reference) = ''
    OR pg_catalog.octet_length(p_reference) > 512
    OR (p_session_id IS NOT NULL AND pg_catalog.btrim(p_session_id) = '')
    OR (p_session_id IS NOT NULL AND pg_catalog.octet_length(p_session_id) > 512)
    OR p_credited_at IS NULL THEN
    RAISE EXCEPTION 'Invalid inflow recognition input' USING ERRCODE = '22023';
  END IF;

  SELECT mapping.merchant_id, mapping.customer_id, mapping.goal_id,
    goal.current_amount, goal.target_amount, goal.status,
    goal.completed_at, goal.goal_kind, goal.source_mode
  INTO v_mapping
  FROM piggyvest_staging.wallet_goal_mappings AS mapping
  JOIN public.customers AS customer
    ON customer.id = mapping.customer_id AND customer.merchant_id = mapping.merchant_id
  JOIN public.customer_savings_goals AS goal
    ON goal.id = mapping.goal_id AND goal.customer_id = mapping.customer_id
      AND goal.merchant_id = mapping.merchant_id
  WHERE mapping.integration_id = v_integration_id
    AND mapping.provider_wallet_id = p_wallet_id
    AND mapping.provider_customer_id = p_provider_customer_id
  FOR UPDATE OF goal;

  IF FOUND THEN
    SELECT system_identifier::text INTO v_system_identifier
    FROM pg_catalog.pg_control_system();
    IF pg_catalog.current_setting('baci.piggyvest_projection_test', true) = 'on' THEN
      IF pg_catalog.current_database() <> 'piggyvest_goal_funding_scratch'
        OR v_system_identifier = '7685292944002592802' THEN
        RAISE EXCEPTION 'projection test identity refused' USING ERRCODE = '55000';
      END IF;
    ELSIF pg_catalog.current_database() <> 'postgres'
      OR v_system_identifier <> '7685292944002592802'
      OR pg_catalog.clock_timestamp() >= pg_catalog.to_timestamp(1790697550) THEN
      RAISE EXCEPTION 'staging projection identity or fixed lease refused' USING ERRCODE = '55000';
    END IF;
    IF v_mapping.goal_kind <> 'legacy' OR v_mapping.source_mode <> 'manual' THEN
      RAISE EXCEPTION 'mapped legacy goal is not eligible for inflow projection' USING ERRCODE = '55000';
    END IF;
    IF p_fee_kobo <> 0 THEN
      RAISE EXCEPTION 'nonzero provider fee requires approved amount semantics' USING ERRCODE = '55000';
    END IF;

    PERFORM registry.id FROM piggyvest_staging.integrations AS registry
    WHERE registry.id = v_integration_id AND registry.enabled FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'staging integration unavailable' USING ERRCODE = '23503';
    END IF;

    INSERT INTO public.piggyvest_inflow_credits (
      provider_transaction_id, event_data_id, event_id, customer_id, wallet_id,
      amount_kobo, fee_kobo, reference, session_id, credited_at
    ) VALUES (
      p_provider_transaction_id, p_event_data_id, p_event_id, p_provider_customer_id,
      p_wallet_id, p_amount_kobo, p_fee_kobo, p_reference, p_session_id, p_credited_at
    ) ON CONFLICT (provider_transaction_id) DO NOTHING;
    SELECT event_data_id, event_id, customer_id, wallet_id, amount_kobo,
      fee_kobo, reference, session_id, credited_at
    INTO v_credit FROM public.piggyvest_inflow_credits
    WHERE provider_transaction_id = p_provider_transaction_id FOR UPDATE;
    IF NOT FOUND OR v_credit.event_data_id IS DISTINCT FROM p_event_data_id
      OR v_credit.event_id IS DISTINCT FROM p_event_id
      OR v_credit.customer_id IS DISTINCT FROM p_provider_customer_id
      OR v_credit.wallet_id IS DISTINCT FROM p_wallet_id
      OR v_credit.amount_kobo IS DISTINCT FROM p_amount_kobo
      OR v_credit.fee_kobo IS DISTINCT FROM p_fee_kobo
      OR v_credit.reference IS DISTINCT FROM p_reference
      OR v_credit.session_id IS DISTINCT FROM p_session_id
      OR v_credit.credited_at IS DISTINCT FROM p_credited_at THEN
      RAISE EXCEPTION 'Conflicting duplicate provider inflow' USING ERRCODE = '23505';
    END IF;

    SELECT integration_id, provider_wallet_id, provider_customer_id, merchant_id,
      customer_id, goal_id, event_data_id, event_id, amount_kobo, fee_kobo,
      reference, session_id, credited_at
    INTO v_projection FROM piggyvest_staging.goal_inflow_projections
    WHERE provider_transaction_id = p_provider_transaction_id FOR UPDATE;
    IF FOUND THEN
      IF v_projection.integration_id IS DISTINCT FROM v_integration_id
        OR v_projection.provider_wallet_id IS DISTINCT FROM p_wallet_id
        OR v_projection.provider_customer_id IS DISTINCT FROM p_provider_customer_id
        OR v_projection.merchant_id IS DISTINCT FROM v_mapping.merchant_id
        OR v_projection.customer_id IS DISTINCT FROM v_mapping.customer_id
        OR v_projection.goal_id IS DISTINCT FROM v_mapping.goal_id
        OR v_projection.event_data_id IS DISTINCT FROM p_event_data_id
        OR v_projection.event_id IS DISTINCT FROM p_event_id
        OR v_projection.amount_kobo IS DISTINCT FROM p_amount_kobo
        OR v_projection.fee_kobo IS DISTINCT FROM p_fee_kobo
        OR v_projection.reference IS DISTINCT FROM p_reference
        OR v_projection.session_id IS DISTINCT FROM p_session_id
        OR v_projection.credited_at IS DISTINCT FROM p_credited_at THEN
        RAISE EXCEPTION 'Conflicting PiggyVest goal projection' USING ERRCODE = '23505';
      END IF;
      RETURN 'duplicate';
    END IF;

    IF v_mapping.status <> 'active' THEN
      RAISE EXCEPTION 'mapped legacy goal is not active' USING ERRCODE = '55000';
    END IF;

    v_new_amount := v_mapping.current_amount + (p_amount_kobo::numeric / 100);
    IF v_new_amount > v_mapping.target_amount THEN
      RAISE EXCEPTION 'provider inflow exceeds remaining goal target' USING ERRCODE = '55000';
    END IF;
    v_new_status := CASE WHEN v_new_amount = v_mapping.target_amount THEN 'completed' ELSE 'active' END;
    INSERT INTO public.customer_savings_contributions (
      goal_id, merchant_id, customer_id, amount, source_type, status, processed_at,
      idempotency_key, metadata
    ) VALUES (
      v_mapping.goal_id, v_mapping.merchant_id, v_mapping.customer_id,
      p_amount_kobo::numeric / 100, 'piggyvest_inflow', 'completed', pg_catalog.clock_timestamp(),
      'piggyvest:' || p_provider_transaction_id,
      pg_catalog.jsonb_build_object(
        'provider', 'piggyvest', 'provider_transaction_id', p_provider_transaction_id,
        'event_data_id', p_event_data_id, 'event_id', p_event_id,
        'provider_customer_id', p_provider_customer_id, 'provider_wallet_id', p_wallet_id,
        'amount_kobo', p_amount_kobo, 'fee_kobo', p_fee_kobo,
        'reference', p_reference, 'session_id', p_session_id, 'credited_at', p_credited_at
      )
    ) RETURNING id INTO v_contribution_id;
    INSERT INTO piggyvest_staging.goal_inflow_projections (
      provider_transaction_id, integration_id, provider_wallet_id, provider_customer_id,
      merchant_id, customer_id, goal_id, contribution_id, event_data_id, event_id,
      amount_kobo, fee_kobo, reference, session_id, credited_at
    ) VALUES (
      p_provider_transaction_id, v_integration_id, p_wallet_id, p_provider_customer_id,
      v_mapping.merchant_id, v_mapping.customer_id, v_mapping.goal_id, v_contribution_id,
      p_event_data_id, p_event_id, p_amount_kobo, p_fee_kobo, p_reference, p_session_id, p_credited_at
    );
    UPDATE public.customer_savings_goals
    SET current_amount = v_new_amount, status = v_new_status,
      completed_at = CASE
        WHEN v_new_status = 'completed' AND completed_at IS NULL THEN pg_catalog.clock_timestamp()
        ELSE completed_at END,
      updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_mapping.goal_id;
    RETURN 'recognized';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.piggyvest_plan_wallets AS mapping
    WHERE mapping.piggyvest_customer_id = p_provider_customer_id
      AND mapping.wallet_id = p_wallet_id
  ) THEN
    RAISE EXCEPTION 'No exact plan-wallet mapping for inflow' USING ERRCODE = '23503';
  END IF;
  SELECT amount_kobo, wallet_id, customer_id INTO v_credit
  FROM public.piggyvest_inflow_credits
  WHERE provider_transaction_id = p_provider_transaction_id;
  IF FOUND THEN
    IF v_credit.amount_kobo <> p_amount_kobo OR v_credit.wallet_id <> p_wallet_id
      OR v_credit.customer_id <> p_provider_customer_id THEN
      RAISE EXCEPTION 'Conflicting duplicate provider inflow' USING ERRCODE = '23505';
    END IF;
    RETURN 'duplicate';
  END IF;
  INSERT INTO public.piggyvest_inflow_credits (
    provider_transaction_id, event_data_id, event_id, customer_id, wallet_id,
    amount_kobo, fee_kobo, reference, session_id, credited_at
  ) VALUES (
    p_provider_transaction_id, p_event_data_id, p_event_id, p_provider_customer_id,
    p_wallet_id, p_amount_kobo, p_fee_kobo, p_reference, p_session_id, p_credited_at
  ) ON CONFLICT (provider_transaction_id) DO NOTHING;
  IF FOUND THEN RETURN 'recognized'; END IF;
  SELECT amount_kobo, wallet_id, customer_id INTO v_credit
  FROM public.piggyvest_inflow_credits
  WHERE provider_transaction_id = p_provider_transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inflow recognition conflict was not readable' USING ERRCODE = '40001';
  END IF;
  IF v_credit.amount_kobo <> p_amount_kobo OR v_credit.wallet_id <> p_wallet_id
    OR v_credit.customer_id <> p_provider_customer_id THEN
    RAISE EXCEPTION 'Conflicting duplicate provider inflow' USING ERRCODE = '23505';
  END IF;
  RETURN 'duplicate';
END
$function$;

CREATE OR REPLACE FUNCTION public.resolve_piggyvest_staging_goal_mapping(
  p_provider_customer_id text, p_wallet_id text
)
RETURNS TABLE (
  customer_id text, merchant_id text,
  provider_customer_id text, provider_wallet_id text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_integration_id constant uuid := 'd91d9e87-8e0d-44de-9b84-1e1d709633d2';
  v_system_identifier text;
BEGIN
  IF p_provider_customer_id IS NULL OR pg_catalog.btrim(p_provider_customer_id) = ''
    OR pg_catalog.octet_length(p_provider_customer_id) > 512
    OR p_wallet_id IS NULL OR pg_catalog.btrim(p_wallet_id) = ''
    OR pg_catalog.octet_length(p_wallet_id) > 512 THEN
    RAISE EXCEPTION 'Invalid mapping identity' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM piggyvest_staging.wallet_goal_mappings AS mapping
    JOIN public.customer_savings_goals AS goal ON goal.id = mapping.goal_id
    WHERE mapping.integration_id = v_integration_id AND mapping.provider_wallet_id = p_wallet_id
      AND mapping.provider_customer_id = p_provider_customer_id
      AND goal.goal_kind = 'legacy' AND goal.source_mode = 'manual'
  ) THEN
    SELECT system_identifier::text INTO v_system_identifier
    FROM pg_catalog.pg_control_system();
    IF pg_catalog.current_setting('baci.piggyvest_projection_test', true) = 'on' THEN
      IF pg_catalog.current_database() <> 'piggyvest_goal_funding_scratch'
        OR v_system_identifier = '7685292944002592802' THEN
        RAISE EXCEPTION 'projection test identity refused' USING ERRCODE = '55000';
      END IF;
    ELSIF pg_catalog.current_database() <> 'postgres'
      OR v_system_identifier <> '7685292944002592802'
      OR pg_catalog.clock_timestamp() >= pg_catalog.to_timestamp(1790697550) THEN
      RAISE EXCEPTION 'staging projection identity or fixed lease refused' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN QUERY
  SELECT mapping.customer_id::text, mapping.merchant_id::text,
    mapping.provider_customer_id, mapping.provider_wallet_id
  FROM piggyvest_staging.wallet_goal_mappings AS mapping
  JOIN piggyvest_staging.integrations AS registry
    ON registry.id = mapping.integration_id AND registry.enabled
  JOIN public.customers AS customer
    ON customer.id = mapping.customer_id AND customer.merchant_id = mapping.merchant_id
  JOIN public.customer_savings_goals AS goal
    ON goal.id = mapping.goal_id AND goal.customer_id = mapping.customer_id
      AND goal.merchant_id = mapping.merchant_id
  WHERE mapping.integration_id = v_integration_id
    AND mapping.provider_wallet_id = p_wallet_id
    AND mapping.provider_customer_id = p_provider_customer_id
    AND goal.goal_kind = 'legacy' AND goal.source_mode = 'manual'
  UNION ALL
  SELECT mapping.customer_id::text, mapping.merchant_id::text,
    mapping.piggyvest_customer_id, mapping.wallet_id
  FROM public.piggyvest_plan_wallets AS mapping
  WHERE mapping.wallet_id = p_wallet_id
    AND mapping.piggyvest_customer_id = p_provider_customer_id;
END
$function$;
