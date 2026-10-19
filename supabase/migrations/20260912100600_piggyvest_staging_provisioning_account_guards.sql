BEGIN;

ALTER TABLE piggyvest_staging.provisioning_integrations ADD COLUMN expected_provider_account_id text COLLATE "C";
UPDATE piggyvest_staging.provisioning_integrations AS binding
  SET expected_provider_account_id = registry.expected_provider_account_id
  FROM piggyvest_staging.integrations AS registry WHERE registry.id = binding.integration_id;
ALTER TABLE piggyvest_staging.provisioning_integrations
  ALTER COLUMN expected_provider_account_id SET NOT NULL,
  ADD CONSTRAINT provisioning_account_id_bounded CHECK (
    pg_catalog.octet_length(expected_provider_account_id) BETWEEN 1 AND 512);

CREATE FUNCTION piggyvest_staging.guard_provisioning_account()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  registry_account_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.expected_provider_account_id IS DISTINCT FROM OLD.expected_provider_account_id THEN
      RAISE EXCEPTION 'immutable provisioning account' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT registry.expected_provider_account_id INTO registry_account_id
    FROM piggyvest_staging.integrations AS registry WHERE registry.id = NEW.integration_id FOR SHARE;
  IF NOT FOUND OR (NEW.expected_provider_account_id IS NOT NULL
    AND NEW.expected_provider_account_id IS DISTINCT FROM registry_account_id) THEN
    RAISE EXCEPTION 'invalid provisioning account' USING ERRCODE = '23514';
  END IF;
  NEW.expected_provider_account_id := registry_account_id;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_provisioning_account_rows
  BEFORE INSERT OR UPDATE ON piggyvest_staging.provisioning_integrations
  FOR EACH ROW EXECUTE FUNCTION piggyvest_staging.guard_provisioning_account();

CREATE FUNCTION piggyvest_staging.guard_provisioning_transaction()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'provisioning requires READ COMMITTED' USING ERRCODE = '22023';
  END IF;
  IF NEW.status IN ('pending', 'dispatched') AND NOT EXISTS (
    SELECT 1 FROM piggyvest_staging.provisioning_integrations AS binding
      JOIN piggyvest_staging.integrations AS registry ON registry.id = binding.integration_id
      WHERE binding.integration_id = NEW.integration_id
        AND binding.expected_provider_account_id = registry.expected_provider_account_id) THEN
    RAISE EXCEPTION 'changed provisioning account requires reconciliation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_provisioning_transaction_rows
  BEFORE INSERT OR UPDATE ON piggyvest_staging.provisioning_intents
  FOR EACH ROW EXECUTE FUNCTION piggyvest_staging.guard_provisioning_transaction();

REVOKE ALL ON FUNCTION piggyvest_staging.guard_provisioning_account() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_staging.guard_provisioning_transaction() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON COLUMN piggyvest_staging.provisioning_integrations.expected_provider_account_id IS
  'Immutable account snapshot resolved from existing registry at owner-only binding creation. Registry account changes must not reuse historical customer correlations to dispatch into another provider business. Existing intent outcomes remain recordable for reconciliation.';
COMMENT ON FUNCTION piggyvest_staging.guard_provisioning_transaction() IS
  'Require READ COMMITTED for mutations: registry locks serialize reference consistency checks with fresh snapshots. New intents and first claims also require unchanged registered business identity. Other isolation levels raise 22023; changed business raises safe 23514. No dispatch follows a failed or uncertain claim commit.';

COMMIT;
