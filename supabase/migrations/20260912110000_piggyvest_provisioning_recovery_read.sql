BEGIN;

CREATE FUNCTION piggyvest_staging.read_provisioning_recovery(
  p_integration_id uuid, p_merchant_id uuid, p_customer_id uuid, p_goal_id uuid,
  p_intent_id uuid, p_expected_business_id text
) RETURNS TABLE (
  intent_id uuid, merchant_id uuid, customer_id uuid, goal_id uuid, operation text,
  status text, provider_customer_id text, provider_wallet_id text, dispatch_provider_customer_id text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_integration_id IS NULL OR p_merchant_id IS NULL OR p_customer_id IS NULL OR p_intent_id IS NULL
    OR p_expected_business_id IS NULL OR pg_catalog.octet_length(p_expected_business_id) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'invalid recovery scope' USING ERRCODE = '22023';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations AS registry
    JOIN piggyvest_staging.provisioning_integrations AS binding ON binding.integration_id = registry.id
    WHERE registry.id = p_integration_id AND binding.merchant_id = p_merchant_id
      AND binding.expected_provider_account_id = p_expected_business_id COLLATE "C"
      AND registry.expected_provider_account_id = p_expected_business_id COLLATE "C"
    FOR SHARE OF registry, binding;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM customer.id FROM public.customers AS customer
    WHERE customer.id = p_customer_id AND customer.merchant_id = p_merchant_id FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF;
  IF p_goal_id IS NOT NULL THEN
    PERFORM goal.id FROM public.customer_savings_goals AS goal
      WHERE goal.id = p_goal_id AND goal.customer_id = p_customer_id AND goal.merchant_id = p_merchant_id FOR SHARE;
    IF NOT FOUND THEN RETURN; END IF;
  END IF;
  RETURN QUERY SELECT entry.id, entry.merchant_id, entry.customer_id, entry.goal_id,
    entry.operation, entry.status, entry.provider_customer_id, entry.provider_wallet_id,
    entry.dispatch_provider_customer_id
    FROM piggyvest_staging.provisioning_intents AS entry
    WHERE entry.id = p_intent_id AND entry.integration_id = p_integration_id
      AND entry.merchant_id = p_merchant_id AND entry.customer_id = p_customer_id
      AND entry.goal_id IS NOT DISTINCT FROM p_goal_id
      AND entry.status IN ('unknown', 'awaiting_confirmation') FOR SHARE OF entry;
END $$;

REVOKE ALL ON FUNCTION piggyvest_staging.read_provisioning_recovery(uuid, uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION piggyvest_staging.read_provisioning_recovery(uuid, uuid, uuid, uuid, uuid, text) IS
  'Private recovery read, zero or one durable acknowledged/unknown intent. Scope: integration,merchant,customer,nullable goal,intent,expected business. Rechecks current local ownership and immutable plus current account binding. Disabled integration remains readable for recovery; changed business fails closed. Does not expire claims, resend, confirm ownership or expose tokens/HMAC/KYC. Grant only to a restricted internal recovery caller after review; IDs are private correlation, never customer authorization.';

COMMIT;
