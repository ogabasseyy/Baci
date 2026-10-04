BEGIN;

CREATE TABLE piggyvest_staging.wallet_goal_mappings (
  integration_id uuid NOT NULL REFERENCES piggyvest_staging.integrations(id),
  provider_wallet_id text COLLATE "C" NOT NULL
    CHECK (pg_catalog.octet_length(provider_wallet_id) BETWEEN 1 AND 512),
  provider_customer_id text COLLATE "C" NOT NULL
    CHECK (pg_catalog.octet_length(provider_customer_id) BETWEEN 1 AND 512),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  goal_id uuid NOT NULL UNIQUE REFERENCES public.customer_savings_goals(id),
  PRIMARY KEY (integration_id, provider_wallet_id)
);
ALTER TABLE piggyvest_staging.wallet_goal_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE piggyvest_staging.wallet_goal_mappings FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX piggyvest_staging_wallet_goal_mappings_merchant_idx
  ON piggyvest_staging.wallet_goal_mappings (merchant_id);
CREATE INDEX piggyvest_staging_wallet_goal_mappings_customer_idx
  ON piggyvest_staging.wallet_goal_mappings (customer_id);

CREATE FUNCTION piggyvest_staging.guard_wallet_goal_mapping()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'staging wallet mapping is immutable' USING ERRCODE = '23514';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations AS registry
    WHERE registry.id = NEW.integration_id AND registry.enabled FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inactive staging integration' USING ERRCODE = '23514';
  END IF;
  PERFORM customer.id FROM public.customers AS customer
    WHERE customer.id = NEW.customer_id AND customer.merchant_id = NEW.merchant_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid staging mapping ownership' USING ERRCODE = '23514';
  END IF;
  PERFORM goal.id FROM public.customer_savings_goals AS goal
    WHERE goal.id = NEW.goal_id AND goal.customer_id = NEW.customer_id
      AND goal.merchant_id = NEW.merchant_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid staging mapping ownership' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER guard_wallet_goal_mapping_rows
  BEFORE INSERT OR UPDATE OR DELETE ON piggyvest_staging.wallet_goal_mappings
  FOR EACH ROW EXECUTE FUNCTION piggyvest_staging.guard_wallet_goal_mapping();
CREATE TRIGGER guard_wallet_goal_mapping_truncate
  BEFORE TRUNCATE ON piggyvest_staging.wallet_goal_mappings
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_staging.guard_wallet_goal_mapping();

CREATE FUNCTION piggyvest_staging.resolve_wallet_mapping(
  p_integration_id uuid, p_provider_wallet_id text, p_provider_customer_id text
) RETURNS TABLE (merchant_id uuid, customer_id uuid, goal_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_integration_id IS NULL OR p_provider_wallet_id IS NULL OR p_provider_customer_id IS NULL
    OR pg_catalog.octet_length(p_provider_wallet_id) NOT BETWEEN 1 AND 512
    OR pg_catalog.octet_length(p_provider_customer_id) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'invalid staging wallet identity' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT mapping.merchant_id, mapping.customer_id, mapping.goal_id
    FROM piggyvest_staging.wallet_goal_mappings AS mapping
    JOIN piggyvest_staging.integrations AS registry ON registry.id = mapping.integration_id AND registry.enabled
    JOIN public.customers AS customer ON customer.id = mapping.customer_id
      AND customer.merchant_id = mapping.merchant_id
    JOIN public.customer_savings_goals AS goal ON goal.id = mapping.goal_id
      AND goal.merchant_id = mapping.merchant_id AND goal.customer_id = mapping.customer_id
    WHERE mapping.integration_id = p_integration_id AND mapping.provider_wallet_id = p_provider_wallet_id
      AND mapping.provider_customer_id = p_provider_customer_id
    FOR SHARE OF registry, customer, goal;
END $$;

REVOKE ALL ON SCHEMA piggyvest_staging FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_staging.guard_wallet_goal_mapping()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_staging.resolve_wallet_mapping(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE piggyvest_staging.wallet_goal_mappings IS
  'Private immutable internal ownership snapshot, not proof of provider ownership. Trusted owner provisioning must independently verify the provider account, wallet and customer against the intended local merchant/customer/goal BEFORE insert. Integration registration alone confers no merchant authority. No write RPC or deployed grants. No updates, deletes or truncation; one wallet per goal across integrations.';
COMMENT ON FUNCTION piggyvest_staging.resolve_wallet_mapping(uuid, text, text) IS
  'Trusted integration UUID plus BOTH opaque provider wallet/customer IDs (1..512 UTF8 bytes). Returns only merchant_id/customer_id/goal_id, zero or one row. Unknown/disabled/mismatched or changed local ownership returns empty; invalid parameters raise 22023. Caller must bind trusted expected merchant and reject mismatch. No payload parsing, provider ownership verification, financial effects or API activation.';

COMMIT;
