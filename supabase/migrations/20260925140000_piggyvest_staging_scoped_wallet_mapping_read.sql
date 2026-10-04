BEGIN;

CREATE FUNCTION piggyvest_staging.read_scoped_wallet_mapping(
  p_integration_id uuid,
  p_merchant_id uuid,
  p_customer_id uuid,
  p_goal_id uuid
) RETURNS TABLE (provider_wallet_id text, provider_customer_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_integration_id IS NULL OR p_merchant_id IS NULL
    OR p_customer_id IS NULL OR p_goal_id IS NULL THEN
    RAISE EXCEPTION 'invalid staging wallet mapping scope' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT mapping.provider_wallet_id, mapping.provider_customer_id
    FROM piggyvest_staging.wallet_goal_mappings AS mapping
    JOIN piggyvest_staging.integrations AS registry
      ON registry.id = mapping.integration_id AND registry.enabled
    JOIN public.customers AS customer
      ON customer.id = mapping.customer_id AND customer.merchant_id = mapping.merchant_id
    JOIN public.customer_savings_goals AS goal
      ON goal.id = mapping.goal_id AND goal.merchant_id = mapping.merchant_id
      AND goal.customer_id = mapping.customer_id AND goal.status = 'active'
    WHERE mapping.integration_id = p_integration_id
      AND mapping.merchant_id = p_merchant_id
      AND mapping.customer_id = p_customer_id
      AND mapping.goal_id = p_goal_id
    FOR SHARE OF mapping, registry, customer, goal;
END $$;

REVOKE ALL ON FUNCTION piggyvest_staging.read_scoped_wallet_mapping(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA piggyvest_staging TO piggyvest_staging_provisioner;
GRANT EXECUTE ON FUNCTION piggyvest_staging.read_scoped_wallet_mapping(uuid, uuid, uuid, uuid)
  TO piggyvest_staging_provisioner;

COMMENT ON FUNCTION piggyvest_staging.read_scoped_wallet_mapping(uuid, uuid, uuid, uuid) IS
  'Restricted staging-only read of one active goal mapping. Requires exact integration, merchant, customer, and goal scope; returns only opaque provider wallet/customer identifiers for subsequent provider ownership and wallet verification. No public, authenticated, service-role, provisioning, interest, or ledger fallback.';

COMMIT;
