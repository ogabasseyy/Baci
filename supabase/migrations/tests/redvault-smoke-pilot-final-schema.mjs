import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Applies the final pilot migration chain (preserved binding through
// atomic activation publish) and asserts the final-schema pilot
// predicates (preserved gates, staging behavior, activation guards).
export function runSmokePilotFinalSchema({ migrations, sql }) {
  for (const part of [
    '20261006190000_uba_redvault_pilot_preserve_binding_after_disable.sql',
    '20261006190100_uba_redvault_pilot_preserved_binding_shipment_savings.sql',
    '20261006190200_uba_redvault_pilot_disabled_policy_staging_passthrough.sql',
    '20261006190300_uba_redvault_pilot_item_fulfillment_guard.sql',
    '20261006190400_uba_redvault_pilot_db_staging_mode.sql',
    '20261006190500_uba_redvault_pilot_bound_product_immutable.sql',
    '20261006190600_uba_redvault_pilot_reenable_and_tracking_guard.sql',
    '20261006190700_uba_redvault_pilot_product_eligibility_guard.sql',
    '20261006190800_uba_redvault_pilot_atomic_activation_publish.sql',
  ]) {
    sql(readFileSync(resolve(migrations, part), 'utf8'));
  }
  sql(`DO $$ BEGIN
    UPDATE private.uba_redvault_live_pilot_policy
    SET product_id = '55555555-5555-4555-8555-555555555555',
        expires_at = pg_catalog.now() + interval '1 hour'
    WHERE singleton;
    PERFORM private.configure_uba_redvault_live_pilot(false, NULL, NULL);
    IF NOT EXISTS (
      SELECT 1 FROM private.uba_redvault_live_pilot_policy
      WHERE singleton AND enabled IS FALSE
        AND product_id = '55555555-5555-4555-8555-555555555555'
        AND expires_at > pg_catalog.now()
    ) THEN RAISE EXCEPTION 'pilot_disable_cleared_binding'; END IF;
    IF strpos(pg_get_functiondef('private.guard_uba_redvault_pilot_order_fulfillment()'::regprocedure), 'policy.product_id IS NOT NULL') = 0 THEN
      RAISE EXCEPTION 'pilot_fulfillment_gate_not_preserved';
    END IF;
    IF strpos(pg_get_functiondef('private.guard_uba_redvault_pilot_shipment_write()'::regprocedure), 'policy.product_id IS NOT NULL') = 0 THEN
      RAISE EXCEPTION 'pilot_shipment_gate_not_preserved';
    END IF;
    IF strpos(pg_get_functiondef('private.guard_uba_redvault_pilot_savings_redemption()'::regprocedure), 'policy.product_id IS NOT NULL') = 0 THEN
      RAISE EXCEPTION 'pilot_savings_gate_not_preserved';
    END IF;
    IF strpos(pg_get_functiondef('private.enforce_uba_redvault_private_pilot_order()'::regprocedure), 'policy.product_id IS NULL') = 0 THEN
      RAISE EXCEPTION 'pilot_binding_staging_passthrough_missing';
    END IF;
    IF strpos(pg_get_functiondef('private.assert_uba_redvault_private_pilot_active(uuid)'::regprocedure), 'policy.product_id IS NOT NULL') = 0 THEN
      RAISE EXCEPTION 'pilot_assert_staging_carveout_missing';
    END IF;
    IF strpos(pg_get_functiondef('private.enforce_uba_redvault_private_pilot_attempt()'::regprocedure), 'policy.product_id IS NULL') = 0 THEN
      RAISE EXCEPTION 'pilot_attempt_staging_passthrough_missing';
    END IF;
    IF strpos(pg_get_functiondef('private.reject_redvault_item_mutation()'::regprocedure), 'uba_redvault_live_pilot_policy') = 0 THEN
      RAISE EXCEPTION 'pilot_item_fulfillment_carveout_missing';
    END IF;
    PERFORM private.enable_uba_redvault_staging_passthrough();
    IF NOT EXISTS (
      SELECT 1 FROM private.uba_redvault_live_pilot_policy
      WHERE singleton AND staging_test_mode IS TRUE
    ) THEN RAISE EXCEPTION 'pilot_staging_enable_missing'; END IF;
    PERFORM private.disable_uba_redvault_staging_passthrough();
    IF NOT EXISTS (
      SELECT 1 FROM private.uba_redvault_live_pilot_policy
      WHERE singleton AND staging_test_mode IS FALSE
    ) THEN RAISE EXCEPTION 'pilot_staging_disable_missing'; END IF;
    IF strpos(pg_get_functiondef('private.enforce_uba_redvault_private_pilot_order()'::regprocedure), 'staging_test_mode') = 0 THEN
      RAISE EXCEPTION 'pilot_binding_staging_mode_missing';
    END IF;
    IF strpos(pg_get_functiondef('private.assert_uba_redvault_private_pilot_active(uuid)'::regprocedure), 'staging_test_mode') = 0 THEN
      RAISE EXCEPTION 'pilot_assert_staging_mode_missing';
    END IF;
    IF strpos(pg_get_functiondef('private.enforce_uba_redvault_private_pilot_attempt()'::regprocedure), 'staging_test_mode') = 0 THEN
      RAISE EXCEPTION 'pilot_attempt_staging_mode_missing';
    END IF;
    IF strpos(pg_get_functiondef('private.configure_uba_redvault_live_pilot(boolean,uuid,timestamptz)'::regprocedure), 'redvault_pilot_bound_product_immutable') = 0 THEN
      RAISE EXCEPTION 'pilot_bound_product_immutability_missing';
    END IF;
    IF strpos(pg_get_functiondef('private.configure_uba_redvault_live_pilot(boolean,uuid,timestamptz)'::regprocedure), 'inventory_tracking_policy') = 0 THEN
      RAISE EXCEPTION 'pilot_activation_tracking_guard_missing';
    END IF;
    IF strpos(pg_get_functiondef('private.configure_uba_redvault_live_pilot(boolean,uuid,timestamptz)'::regprocedure), 'redvault_pilot_product_not_eligible') = 0 THEN
      RAISE EXCEPTION 'pilot_activation_eligibility_guard_missing';
    END IF;
    IF strpos(pg_get_functiondef('private.configure_uba_redvault_live_pilot(boolean,uuid,timestamptz)'::regprocedure), 'redvault_pilot_product_changed_during_activation') = 0 THEN
      RAISE EXCEPTION 'pilot_activation_atomic_publish_missing';
    END IF;
    IF private.is_uba_redvault_negotiable_product('Infinix', 'Hot 40')
      OR private.is_uba_redvault_negotiable_product('Samsung', 'Galaxy A16 5G')
      OR private.is_uba_redvault_negotiable_product('OPPO', 'A-58')
      OR NOT private.is_uba_redvault_negotiable_product('Samsung', 'Galaxy S25')
      OR NOT private.is_uba_redvault_negotiable_product('Apple', 'iPhone 15 Pro Max A2890')
      OR NOT private.is_uba_redvault_negotiable_product(NULL, NULL) THEN
      RAISE EXCEPTION 'pilot_eligibility_policy_not_aligned';
    END IF;
  END $$;`);
}
