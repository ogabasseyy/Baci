CREATE FUNCTION prefunded_card.checkout_capability(
  p_scope jsonb,p_customer uuid,p_actor uuid,p_goal uuid,p_maximum_amount_kobo bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE;
DECLARE goal public.customer_savings_goals%ROWTYPE;
DECLARE pending_kobo bigint; available_float_kobo bigint; remaining_goal_kobo bigint;
DECLARE maximum_kobo bigint := 0; email_value text;
BEGIN
  PERFORM prefunded_card.checkout_require_executor('prefunded_treasury_operator');
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  IF p_customer IS NULL OR p_actor IS NULL OR p_goal IS NULL
    OR p_maximum_amount_kobo IS NULL OR p_maximum_amount_kobo < 0
    OR p_maximum_amount_kobo > 9007199254740991 THEN
    RAISE EXCEPTION 'first-card checkout capability denied' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO binding FROM prefunded_card.treasury_bindings WHERE id=(p_scope->>'treasuryBindingId')::uuid
    AND integration_id=(p_scope->>'integrationId')::uuid AND merchant_id=(p_scope->>'merchantId')::uuid
    AND expected_business_id=p_scope->>'businessId' FOR SHARE;
  IF NOT FOUND OR binding.authorized_login IS DISTINCT FROM session_user OR binding.currency IS DISTINCT FROM 'NGN'
    OR NOT binding.enabled OR NOT prefunded_card.treasury_reservation_ready(binding.id) THEN
    RETURN jsonb_build_object('goalId',p_goal,'enabled',false,'maximumAmountKobo',0,'currency','NGN');
  END IF;
  PERFORM identity.treasury_binding_id FROM prefunded_card.treasury_identities identity
    WHERE identity.treasury_binding_id=binding.id AND identity.integration_id=binding.integration_id
      AND identity.merchant_id=binding.merchant_id AND identity.expected_business_id=binding.expected_business_id
      AND identity.source_wallet_id=binding.source_wallet_id AND identity.authorized_login=binding.authorized_login FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('goalId',p_goal,'enabled',false,'maximumAmountKobo',0,'currency','NGN');
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations registry WHERE registry.id=binding.integration_id
    AND registry.enabled AND registry.expected_provider_account_id=binding.expected_business_id FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('goalId',p_goal,'enabled',false,'maximumAmountKobo',0,'currency','NGN');
  END IF;
  SELECT lower(btrim(customer.email)) INTO email_value FROM public.customers customer WHERE customer.id=p_customer
    AND customer.merchant_id=binding.merchant_id AND customer.user_id=p_actor FOR SHARE;
  IF NOT FOUND OR email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR octet_length(email_value)>254 THEN
    RETURN jsonb_build_object('goalId',p_goal,'enabled',false,'maximumAmountKobo',0,'currency','NGN');
  END IF;
  SELECT * INTO goal FROM public.customer_savings_goals WHERE id=p_goal AND merchant_id=binding.merchant_id
    AND customer_id=p_customer AND goal_kind='legacy' AND status='active' AND completed_at IS NULL
    AND cancelled_at IS NULL AND spent_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('goalId',p_goal,'enabled',false,'maximumAmountKobo',0,'currency','NGN');
  END IF;
  PERFORM mapping.provider_wallet_id FROM piggyvest_staging.wallet_goal_mappings mapping
    WHERE mapping.integration_id=binding.integration_id AND mapping.merchant_id=binding.merchant_id
      AND mapping.customer_id=p_customer AND mapping.goal_id=goal.id FOR SHARE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM prefunded_card.credit_routes route
    WHERE route.goal_id=goal.id AND route.integration_id=binding.integration_id
      AND route.merchant_id=binding.merchant_id AND route.customer_id=p_customer
      AND route.system_identifier=p_scope->>'systemIdentifier'
  ) OR EXISTS (
    SELECT 1 FROM public.customer_saved_payment_methods method
    WHERE method.customer_id=p_customer AND method.provider='paystack'
  ) OR EXISTS (
    SELECT 1 FROM prefunded_card.checkout_intents intent
    WHERE intent.integration_id=binding.integration_id AND intent.merchant_id=binding.merchant_id
      AND intent.customer_id=p_customer
      AND intent.phase<>'completed'
  ) THEN
    RETURN jsonb_build_object('goalId',p_goal,'enabled',false,'maximumAmountKobo',0,'currency','NGN');
  END IF;
  SELECT coalesce(sum(operation.amount_kobo),0) INTO pending_kobo FROM prefunded_card.operations operation
    WHERE operation.goal_id=goal.id AND operation.collection_status NOT IN ('verified_failed','reversed')
      AND operation.projection_status<>'applied';
  remaining_goal_kobo:=greatest((goal.target_amount-goal.current_amount)*100-pending_kobo,0);
  available_float_kobo:=greatest(binding.verified_available_kobo-binding.reserved_kobo-binding.consumed_kobo,0);
  maximum_kobo:=least(p_maximum_amount_kobo,remaining_goal_kobo,available_float_kobo);
  PERFORM prefunded_card.checkout_validate_scope(p_scope,true);
  RETURN jsonb_build_object('goalId',p_goal,'enabled',maximum_kobo>0,
    'maximumAmountKobo',maximum_kobo,'currency','NGN');
END $$;
