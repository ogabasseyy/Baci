BEGIN;
-- Restriction state for staging goal wallets. Wallets provisioned through the
-- /savings/funding flow are recorded only in wallet_goal_mappings, never in
-- the legacy piggyvest_plan_wallets table, so restriction-created/lifted
-- events for those wallets flipped zero rows, classified RESTRICTION_UNMAPPED,
-- and 503-looped until provider retries were exhausted while local
-- funding/outflow state stayed unaware of the restriction.
--
-- restriction_status lives on the mapping row (identity stays immutable: the
-- guard now permits UPDATEs that change only this column). Reads flow through
-- the extended resolve_wallet_mapping; writes go through the service-role-only
-- apply_staging_wallet_restriction flip, which requires exactly one enabled
-- mapping for the wallet and fails closed (false) on unknown or ambiguous
-- wallets so the webhook path keeps its retryable-unmapped semantics.
ALTER TABLE piggyvest_staging.wallet_goal_mappings
  ADD COLUMN IF NOT EXISTS restriction_status text NOT NULL DEFAULT 'ready'
    CHECK (restriction_status IN ('ready', 'restricted'));

CREATE OR REPLACE FUNCTION piggyvest_staging.guard_wallet_goal_mapping()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Restriction flips only: every identity column must be unchanged.
    IF NEW.integration_id IS DISTINCT FROM OLD.integration_id
      OR NEW.provider_wallet_id IS DISTINCT FROM OLD.provider_wallet_id
      OR NEW.provider_customer_id IS DISTINCT FROM OLD.provider_customer_id
      OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
      OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
      OR NEW.goal_id IS DISTINCT FROM OLD.goal_id
    THEN
      RAISE EXCEPTION 'staging wallet mapping identity is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
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

-- RETURNS TABLE gains a column, which CREATE OR REPLACE forbids: drop and
-- recreate, then re-apply the in-chain REVOKE (a fresh CREATE would grant
-- EXECUTE to PUBLIC by default).
DROP FUNCTION IF EXISTS piggyvest_staging.resolve_wallet_mapping(uuid, text, text);
CREATE FUNCTION piggyvest_staging.resolve_wallet_mapping(
  p_integration_id uuid, p_provider_wallet_id text, p_provider_customer_id text
) RETURNS TABLE (merchant_id uuid, customer_id uuid, goal_id uuid, restriction_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_integration_id IS NULL OR p_provider_wallet_id IS NULL OR p_provider_customer_id IS NULL
    OR pg_catalog.octet_length(p_provider_wallet_id) NOT BETWEEN 1 AND 512
    OR pg_catalog.octet_length(p_provider_customer_id) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'invalid staging wallet identity' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT mapping.merchant_id, mapping.customer_id, mapping.goal_id,
      mapping.restriction_status
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

REVOKE ALL ON FUNCTION piggyvest_staging.resolve_wallet_mapping(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION piggyvest_staging.resolve_wallet_mapping(uuid, text, text) IS
  'Trusted integration UUID plus BOTH opaque provider wallet/customer IDs (1..512 UTF8 bytes). Returns merchant_id/customer_id/goal_id plus restriction_status, zero or one row. Unknown/disabled/mismatched or changed local ownership returns empty; invalid parameters raise 22023. Caller must bind trusted expected merchant and reject mismatch.';

CREATE OR REPLACE FUNCTION public.apply_staging_wallet_restriction(
  p_provider_wallet_id text,
  p_restriction_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_provider_wallet_id IS NULL
    OR p_restriction_status IS NULL
    OR p_restriction_status NOT IN ('ready', 'restricted')
    OR pg_catalog.octet_length(p_provider_wallet_id) NOT BETWEEN 1 AND 512
  THEN
    RAISE EXCEPTION 'staging restriction flip requires a wallet and a status'
      USING ERRCODE = '22023';
  END IF;

  -- Exactly one enabled mapping owns the wallet, or nothing flips: flipping
  -- the wrong wallet is worse than flipping none, so unknown and ambiguous
  -- wallets report false and the webhook path retries.
  SELECT count(*)
    INTO v_count
    FROM piggyvest_staging.wallet_goal_mappings AS mapping
    JOIN piggyvest_staging.integrations AS registry
      ON registry.id = mapping.integration_id AND registry.enabled
    WHERE mapping.provider_wallet_id = p_provider_wallet_id;

  IF v_count = 1 THEN
    UPDATE piggyvest_staging.wallet_goal_mappings AS mapping
      SET restriction_status = p_restriction_status
      FROM piggyvest_staging.integrations AS registry
      WHERE registry.id = mapping.integration_id AND registry.enabled
        AND mapping.provider_wallet_id = p_provider_wallet_id;
    RETURN FOUND;
  END IF;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_staging_wallet_restriction(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_staging_wallet_restriction(text, text)
  TO service_role;

COMMENT ON FUNCTION public.apply_staging_wallet_restriction(text, text) IS
  'Webhook-worker-only restriction flip for staging goal wallets. Requires exactly one enabled mapping for the wallet; unknown or ambiguous wallets return false so intake fails closed to retryable-unmapped.';
COMMIT;
