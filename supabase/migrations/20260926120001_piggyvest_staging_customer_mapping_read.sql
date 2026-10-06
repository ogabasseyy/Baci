BEGIN;

CREATE FUNCTION piggyvest_staging.read_customer_mapping(
  p_integration_id uuid,
  p_merchant_id uuid,
  p_customer_id uuid,
  p_expected_business_id text
) RETURNS TABLE (outcome text, provider_customer_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  mapping_count bigint;
  scoped_mapping_count bigint;
  customer_count bigint;
  provider_count bigint;
  resolved_provider_customer_id text;
  registry_business_id text;
  registry_enabled boolean;
BEGIN
  IF p_integration_id IS NULL OR p_merchant_id IS NULL OR p_customer_id IS NULL
    OR p_expected_business_id IS NULL
    OR pg_catalog.octet_length(p_expected_business_id) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'invalid staging customer mapping scope' USING ERRCODE = '22023';
  END IF;
  SELECT registry.expected_provider_account_id, registry.enabled
    INTO registry_business_id, registry_enabled
    FROM piggyvest_staging.integrations AS registry
    WHERE registry.id = p_integration_id FOR SHARE;
  IF NOT FOUND OR registry_enabled IS DISTINCT FROM true THEN
    RETURN QUERY SELECT 'disabled'::text, NULL::text; RETURN;
  END IF;
  IF registry_business_id IS DISTINCT FROM p_expected_business_id COLLATE "C" THEN
    RETURN QUERY SELECT 'business_mismatch'::text, NULL::text; RETURN;
  END IF;

  SELECT pg_catalog.count(*), pg_catalog.count(DISTINCT mapping.customer_id),
    pg_catalog.count(DISTINCT mapping.provider_customer_id),
    (pg_catalog.min(mapping.provider_customer_id COLLATE "C"))::text
  INTO mapping_count, customer_count, provider_count, resolved_provider_customer_id
  FROM piggyvest_staging.wallet_goal_mappings AS mapping
  JOIN public.customers AS customer
    ON customer.id = mapping.customer_id AND customer.merchant_id = mapping.merchant_id
  JOIN public.customer_savings_goals AS goal
    ON goal.id = mapping.goal_id AND goal.customer_id = mapping.customer_id
      AND goal.merchant_id = mapping.merchant_id
  WHERE mapping.integration_id = p_integration_id
    AND mapping.merchant_id = p_merchant_id AND mapping.customer_id = p_customer_id;

  SELECT pg_catalog.count(*) INTO scoped_mapping_count
  FROM piggyvest_staging.wallet_goal_mappings AS mapping
  WHERE mapping.integration_id = p_integration_id
    AND mapping.merchant_id = p_merchant_id AND mapping.customer_id = p_customer_id;

  IF scoped_mapping_count = 0 THEN RETURN QUERY SELECT 'none'::text, NULL::text; RETURN; END IF;
  IF mapping_count <> scoped_mapping_count OR customer_count <> 1 OR provider_count <> 1 THEN
    RETURN QUERY SELECT 'conflict'::text, NULL::text; RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM piggyvest_staging.wallet_goal_mappings AS mapping
    WHERE mapping.integration_id = p_integration_id
      AND mapping.provider_customer_id = resolved_provider_customer_id COLLATE "C"
      AND (mapping.merchant_id <> p_merchant_id OR mapping.customer_id <> p_customer_id)
  ) OR EXISTS (
    SELECT 1 FROM piggyvest_staging.provisioning_intents AS intent
    WHERE intent.integration_id = p_integration_id
      AND intent.merchant_id = p_merchant_id
      AND intent.customer_id = p_customer_id
      AND intent.operation = 'create_customer'
      AND intent.provider_customer_id IS NOT NULL
      AND intent.provider_customer_id <> resolved_provider_customer_id COLLATE "C"
  ) THEN
    RETURN QUERY SELECT 'conflict'::text, NULL::text; RETURN;
  END IF;
  RETURN QUERY SELECT 'mapped'::text, resolved_provider_customer_id;
END $$;

REVOKE ALL ON FUNCTION piggyvest_staging.read_customer_mapping(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'piggyvest_staging_provisioner') THEN
    GRANT EXECUTE ON FUNCTION piggyvest_staging.read_customer_mapping(uuid, uuid, uuid, text)
      TO piggyvest_staging_provisioner;
  END IF;
END $$;

COMMENT ON FUNCTION piggyvest_staging.read_customer_mapping(uuid, uuid, uuid, text) IS
  'Restricted staging read of an existing provider customer ID derived only from immutable verified wallet mappings for the exact integration, merchant, customer and expected business. Disabled or wrong-business registry state is explicit; provider IDs mapped to another local customer or contradicted by a durable customer intent fail closed. Contact data and provider responses are not evidence.';

COMMIT;
