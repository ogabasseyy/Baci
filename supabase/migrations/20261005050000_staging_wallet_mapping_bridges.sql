-- Trusted bridges between staging goal-wallet mappings and the ledger
-- intake path.
--
-- The staging funding flow provisions one wallet per savings goal, but
-- nothing persisted the (wallet, customer) -> (merchant, customer, goal)
-- binding: `piggyvest_plan_wallets` holds one row per customer (the
-- production path), and `piggyvest_staging.wallet_goal_mappings` had no
-- writer, so funding-accounts retrieval 202-looped on MAPPING_PENDING
-- while inflow/interest webhooks for dedicated wallets 503-looped on
-- UNMAPPED. These two functions close both gaps without widening any
-- trust boundary:
--
-- - `record_wallet_goal_mapping` (provisioner-only) persists the binding
--   at provisioning time. It is idempotent for identical re-records and
--   raises on conflicting reuse of a wallet identity.
-- - `resolve_staging_wallet_owner` (service-role-only) answers the one
--   question intake may ask the staging registry: which local tenant owns
--   this destination pair. It returns a row only for exactly one enabled
--   mapping and fails closed (no rows) otherwise, so the ledgers keep
--   their retryable-unmapped semantics for unknown or ambiguous wallets.

CREATE OR REPLACE FUNCTION piggyvest_staging.record_wallet_goal_mapping(
  p_integration_id uuid,
  p_provider_wallet_id text,
  p_provider_customer_id text,
  p_merchant_id uuid,
  p_customer_id uuid,
  p_goal_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_existing record;
BEGIN
  IF p_integration_id IS NULL
    OR p_provider_wallet_id IS NULL
    OR p_provider_customer_id IS NULL
    OR p_merchant_id IS NULL
    OR p_customer_id IS NULL
    OR p_goal_id IS NULL
    OR octet_length(p_provider_wallet_id) NOT BETWEEN 1 AND 512
    OR octet_length(p_provider_customer_id) NOT BETWEEN 1 AND 512
  THEN
    RAISE EXCEPTION 'wallet goal mapping requires an integration, wallet, customer, merchant, and goal'
      USING ERRCODE = '22023';
  END IF;

  PERFORM registry.id
    FROM piggyvest_staging.integrations AS registry
    WHERE registry.id = p_integration_id AND registry.enabled;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inactive staging integration'
      USING ERRCODE = '23514';
  END IF;

  PERFORM customer.id
    FROM public.customers AS customer
    WHERE customer.id = p_customer_id
      AND customer.merchant_id = p_merchant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid staging mapping ownership'
      USING ERRCODE = '23514';
  END IF;

  PERFORM goal.id
    FROM public.customer_savings_goals AS goal
    WHERE goal.id = p_goal_id
      AND goal.customer_id = p_customer_id
      AND goal.merchant_id = p_merchant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid staging mapping ownership'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO piggyvest_staging.wallet_goal_mappings AS mapping (
    integration_id,
    provider_wallet_id,
    provider_customer_id,
    merchant_id,
    customer_id,
    goal_id
  )
  VALUES (
    p_integration_id,
    p_provider_wallet_id,
    p_provider_customer_id,
    p_merchant_id,
    p_customer_id,
    p_goal_id
  )
  ON CONFLICT (integration_id, provider_wallet_id) DO NOTHING;

  SELECT mapping.merchant_id, mapping.customer_id, mapping.goal_id,
    mapping.provider_customer_id
    INTO v_existing
    FROM piggyvest_staging.wallet_goal_mappings AS mapping
    WHERE mapping.integration_id = p_integration_id
      AND mapping.provider_wallet_id = p_provider_wallet_id;

  IF v_existing.merchant_id IS DISTINCT FROM p_merchant_id
    OR v_existing.customer_id IS DISTINCT FROM p_customer_id
    OR v_existing.goal_id IS DISTINCT FROM p_goal_id
    OR v_existing.provider_customer_id IS DISTINCT FROM p_provider_customer_id
  THEN
    RAISE EXCEPTION 'staging wallet identity already mapped to a different goal'
      USING ERRCODE = '23505';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION piggyvest_staging.record_wallet_goal_mapping(uuid, text, text, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'piggyvest_staging_provisioner') THEN
    GRANT EXECUTE ON FUNCTION piggyvest_staging.record_wallet_goal_mapping(uuid, text, text, uuid, uuid, uuid)
      TO piggyvest_staging_provisioner;
  END IF;
END $$;

COMMENT ON FUNCTION piggyvest_staging.record_wallet_goal_mapping(uuid, text, text, uuid, uuid, uuid) IS
  'Provisioner-only write of one staging wallet-to-goal binding. Enabled integration plus local customer/goal ownership required; identical re-records are idempotent, conflicting reuse raises. The row trigger re-verifies every insert.';

CREATE OR REPLACE FUNCTION public.resolve_staging_wallet_owner(
  p_provider_wallet_id text,
  p_provider_customer_id text
)
RETURNS TABLE (
  merchant_id uuid,
  customer_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_count integer;
  v_merchant_id uuid;
  v_customer_id uuid;
BEGIN
  IF p_provider_wallet_id IS NULL
    OR p_provider_customer_id IS NULL
    OR length(trim(p_provider_wallet_id)) = 0
    OR length(trim(p_provider_customer_id)) = 0
  THEN
    RETURN;
  END IF;

  -- Exactly one enabled mapping owns the pair, or the wallet stays
  -- unmapped: zero rows (unknown wallet) and conflicting rows (same pair
  -- under several integrations) both fail closed so intake keeps its
  -- retryable semantics instead of guessing a tenant.
  SELECT count(*)
    INTO v_count
    FROM piggyvest_staging.wallet_goal_mappings AS mapping
    JOIN piggyvest_staging.integrations AS registry
      ON registry.id = mapping.integration_id AND registry.enabled
    WHERE mapping.provider_wallet_id = p_provider_wallet_id
      AND mapping.provider_customer_id = p_provider_customer_id;

  IF v_count = 1 THEN
    SELECT mapping.merchant_id, mapping.customer_id
      INTO v_merchant_id, v_customer_id
      FROM piggyvest_staging.wallet_goal_mappings AS mapping
      JOIN piggyvest_staging.integrations AS registry
        ON registry.id = mapping.integration_id AND registry.enabled
      WHERE mapping.provider_wallet_id = p_provider_wallet_id
        AND mapping.provider_customer_id = p_provider_customer_id;
    RETURN QUERY SELECT v_merchant_id, v_customer_id;
  END IF;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_staging_wallet_owner(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_staging_wallet_owner(text, text)
  TO service_role;

COMMENT ON FUNCTION public.resolve_staging_wallet_owner(text, text) IS
  'Webhook-worker-only read of the local tenant owning a staging destination pair. Returns a row only for exactly one enabled mapping; unknown or ambiguous wallets return nothing so intake fails closed to retryable-unmapped.';
