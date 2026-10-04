BEGIN;

LOCK TABLE piggyvest_staging.wallet_goal_mappings IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM piggyvest_staging.wallet_goal_mappings
    GROUP BY integration_id, provider_customer_id HAVING count(DISTINCT customer_id) > 1)
    OR EXISTS (SELECT 1 FROM piggyvest_staging.wallet_goal_mappings
      GROUP BY integration_id, customer_id HAVING count(DISTINCT provider_customer_id) > 1) THEN
    RAISE EXCEPTION 'inconsistent staging customer bindings require owner review' USING ERRCODE = '23514';
  END IF;
END $$;

CREATE INDEX piggyvest_staging_wallet_mapping_provider_customer_idx
  ON piggyvest_staging.wallet_goal_mappings (integration_id, provider_customer_id);
CREATE INDEX piggyvest_staging_wallet_mapping_local_customer_idx
  ON piggyvest_staging.wallet_goal_mappings (integration_id, customer_id);

CREATE OR REPLACE FUNCTION piggyvest_staging.guard_wallet_goal_mapping()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'staging wallet mapping is immutable' USING ERRCODE = '23514';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'staging mapping provisioning requires READ COMMITTED' USING ERRCODE = '22023';
  END IF;
  PERFORM registry.id FROM piggyvest_staging.integrations AS registry
    WHERE registry.id = NEW.integration_id AND registry.enabled FOR UPDATE;
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
  IF EXISTS (SELECT 1 FROM piggyvest_staging.wallet_goal_mappings AS mapping
    WHERE mapping.integration_id = NEW.integration_id
      AND ((mapping.provider_customer_id = NEW.provider_customer_id AND mapping.customer_id <> NEW.customer_id)
        OR (mapping.customer_id = NEW.customer_id AND mapping.provider_customer_id <> NEW.provider_customer_id))) THEN
    RAISE EXCEPTION 'conflicting staging customer binding' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION piggyvest_staging.guard_wallet_goal_mapping()
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION piggyvest_staging.guard_wallet_goal_mapping() IS
  'Owner-only provisioning at READ COMMITTED. Registry FOR UPDATE serializes inserts per integration; subsequent consistency checks use fresh snapshots. Provider customer and local customer must remain one-to-one per integration; multiple wallets/goals for the same pair are allowed. Internal consistency is not proof of provider ownership; independent verification remains mandatory.';

COMMIT;
