import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Applies the fixed-five policy plus the private-pilot migration chain and
// asserts the final-schema pilot predicates (grants, lock order, guards,
// staging behavior).
export function runSmokePilotPhases({ migrations, sql }) {
  sql(
    readFileSync(
      resolve(
        migrations,
        '20260928105900_uba_redvault_existing_binding_five_percent.sql'
      ),
      'utf8'
    )
  );
  sql(
    readFileSync(
      resolve(migrations, '20260928110000_uba_redvault_fixed_five_percent.sql'),
      'utf8'
    )
  );
  sql(
    readFileSync(
      resolve(migrations, '20260928110000_uba_redvault_fixed_five_percent.sql'),
      'utf8'
    )
  );
  sql(`DO $$ BEGIN
    IF strpos(pg_get_functiondef('private.validate_redvault_snapshot(uuid,jsonb)'::regprocedure), 'v_rate := 5;') = 0
      OR strpos(pg_get_functiondef('public.create_storefront_redvault_order_draft(jsonb,jsonb)'::regprocedure), '''mou_tiered_v1''') > 0
      OR strpos(pg_get_functiondef('private.validate_redvault_discount_binding()'::regprocedure), 'discount_value IN (5, 10)') > 0 THEN
      RAISE EXCEPTION 'redvault_fixed_five_policy_not_applied';
    END IF;
  END $$;`);
  for (const filename of [
    '20260928120000_uba_redvault_private_pilot_policy.sql',
    '20260928120500_uba_redvault_private_pilot_order_guard.sql',
    '20260928121000_uba_redvault_private_pilot_attempt_guards.sql',
    '20260928121500_uba_redvault_private_pilot_rpc_wrappers.sql',
    '20260928122000_uba_redvault_private_pilot_fulfillment_guards.sql',
  ]) {
    sql(readFileSync(resolve(migrations, filename), 'utf8'));
  }
  process.stdout.write(
    sql(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM private.uba_redvault_live_pilot_policy WHERE enabled) THEN
      RAISE EXCEPTION 'pilot_enabled_on_install';
    END IF;
    IF has_function_privilege('authenticated', 'private.configure_uba_redvault_live_pilot(boolean,uuid,timestamptz)', 'EXECUTE')
      OR has_function_privilege('service_role', 'private.configure_uba_redvault_live_pilot(boolean,uuid,timestamptz)', 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.reserve_storefront_redvault_payment_attempt_v3_pre_pilot(uuid)', 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.claim_redvault_initialization_v3_pre_pilot(uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'pilot_private_grant_leak';
    END IF;
  END $$; SELECT 'Private pilot migration applied to final-schema chain with default-off and protected grants' AS result;`)
  );
  sql(
    readFileSync(
      resolve(
        migrations,
        '20260929100000_uba_redvault_pilot_legacy_and_shipment_guards.sql'
      ),
      'utf8'
    )
  );
  sql(`DO $$ BEGIN
    IF EXISTS (
      SELECT 1 FROM (VALUES
        ('public.reserve_storefront_redvault_payment_attempt(uuid)'),
        ('public.reserve_storefront_redvault_payment_attempt_v2(uuid)'),
        ('public.claim_storefront_redvault_payment_attempt_initialization(uuid)'),
        ('public.claim_storefront_redvault_payment_attempt_initialization_v2(uuid)')
      ) AS legacy(signature)
      CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS caller(role_name)
      WHERE has_function_privilege(caller.role_name, legacy.signature, 'EXECUTE')
    ) THEN RAISE EXCEPTION 'pilot_legacy_rpc_grant_leak'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.shipments'::regclass
        AND tgname = 'guard_uba_redvault_pilot_shipment_write'
        AND tgenabled = 'O' AND tgtype = 23
    ) THEN RAISE EXCEPTION 'pilot_shipment_guard_missing'; END IF;
  END $$;`);
  sql(
    readFileSync(
      resolve(
        migrations,
        '20261006120100_uba_redvault_pilot_review_followups.sql'
      ),
      'utf8'
    )
  );
  sql(`DO $$ BEGIN
    IF to_regprocedure('private.block_uba_redvault_pilot_postapproval_fulfillment()') IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.orders'::regclass
          AND tgname = 'block_uba_redvault_pilot_postapproval_fulfillment'
      ) THEN RAISE EXCEPTION 'pilot_postapproval_guard_not_replaced'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.orders'::regclass
        AND tgname = 'guard_uba_redvault_pilot_order_fulfillment'
        AND tgenabled = 'O' AND tgtype = 19
    ) THEN RAISE EXCEPTION 'pilot_order_fulfillment_guard_missing'; END IF;
    IF strpos(pg_get_functiondef('private.enforce_uba_redvault_private_pilot_expiry()'::regprocedure), 'OLD.state IS DISTINCT FROM ''initializing''') = 0
      OR strpos(pg_get_functiondef('private.guard_uba_redvault_pilot_order_fulfillment()'::regprocedure), 'IS DISTINCT FROM ''cancelled''') = 0
      OR strpos(pg_get_functiondef('private.guard_uba_redvault_pilot_order_fulfillment()'::regprocedure), 'IS DISTINCT FROM ''canceled''') = 0 THEN
      RAISE EXCEPTION 'pilot_review_followups_not_applied';
    END IF;
  END $$;`);
  sql(
    readFileSync(
      resolve(
        migrations,
        '20261006130000_uba_redvault_pilot_permit_payment_completion.sql'
      ),
      'utf8'
    )
  );
  sql(`DO $$ BEGIN
    IF strpos(pg_get_functiondef('private.guard_uba_redvault_pilot_order_fulfillment()'::regprocedure), 'IS NOT DISTINCT FROM ''processing''') = 0 THEN
      RAISE EXCEPTION 'pilot_payment_completion_carve_out_missing';
    END IF;
  END $$;`);
  sql(
    readFileSync(
      resolve(
        migrations,
        '20261006140000_uba_redvault_pilot_product_boundary.sql'
      ),
      'utf8'
    )
  );
  sql(`DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.order_items'::regclass
        AND tgname = 'guard_uba_redvault_pilot_product_orders'
        AND tgenabled = 'O' AND tgtype = 23
    ) THEN RAISE EXCEPTION 'pilot_product_boundary_guard_missing'; END IF;
    IF strpos(pg_get_functiondef('private.guard_uba_redvault_pilot_product_orders()'::regprocedure), 'redvault_pilot_product_restricted') = 0 THEN
      RAISE EXCEPTION 'pilot_product_boundary_not_applied';
    END IF;
  END $$;`);
  sql(
    readFileSync(
      resolve(
        migrations,
        '20261006150000_uba_redvault_pilot_binding_and_cancel_guards.sql'
      ),
      'utf8'
    )
  );
  sql(`DO $$ BEGIN
    IF strpos(pg_get_functiondef('private.assert_uba_redvault_private_pilot_active(uuid)'::regprocedure), 'redvault_pilot_order_cancelled') = 0 THEN
      RAISE EXCEPTION 'pilot_cancelled_reserve_guard_missing';
    END IF;
    IF strpos(pg_get_functiondef('private.enforce_uba_redvault_private_pilot_order()'::regprocedure), 'shipment_booking_lock_token') = 0 THEN
      RAISE EXCEPTION 'pilot_prefilled_fulfillment_guard_missing';
    END IF;
  END $$;`);
  sql(
    readFileSync(
      resolve(
        migrations,
        '20261006160000_uba_redvault_pilot_activation_lock_and_policy_indexes.sql'
      ),
      'utf8'
    )
  );
  sql(`DO $$ BEGIN
    IF strpos(pg_get_functiondef('private.guard_uba_redvault_pilot_product_orders()'::regprocedure), 'FOR SHARE') = 0 THEN
      RAISE EXCEPTION 'pilot_boundary_activation_lock_missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
        WHERE schemaname = 'private' AND tablename = 'uba_redvault_live_pilot_policy'
        AND indexname = 'uba_redvault_live_pilot_policy_reserved_order_id_idx')
      OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
        WHERE schemaname = 'private' AND tablename = 'uba_redvault_live_pilot_policy'
        AND indexname = 'uba_redvault_live_pilot_policy_reserved_attempt_id_idx') THEN
      RAISE EXCEPTION 'pilot_policy_reservation_indexes_missing';
    END IF;
  END $$;`);
  sql(
    readFileSync(
      resolve(
        migrations,
        '20261006170000_uba_redvault_pilot_reserve_lock_order.sql'
      ),
      'utf8'
    )
  );
  sql(`DO $$ DECLARE
    reserve_def text := pg_get_functiondef('public.reserve_storefront_redvault_payment_attempt_v3(uuid)'::regprocedure);
    attempt_def text := pg_get_functiondef('private.enforce_uba_redvault_private_pilot_attempt()'::regprocedure);
  BEGIN
    IF strpos(reserve_def, 'FOR UPDATE') = 0
      OR strpos(reserve_def, 'pg_advisory_xact_lock') = 0
      OR strpos(reserve_def, 'FOR UPDATE') > strpos(reserve_def, 'pg_advisory_xact_lock') THEN
      RAISE EXCEPTION 'pilot_reserve_lock_order_not_applied';
    END IF;
    IF strpos(attempt_def, 'FOR UPDATE') = 0
      OR strpos(attempt_def, 'pg_advisory_xact_lock') = 0
      OR strpos(attempt_def, 'FOR UPDATE') > strpos(attempt_def, 'pg_advisory_xact_lock') THEN
      RAISE EXCEPTION 'pilot_attempt_lock_order_not_applied';
    END IF;
  END $$;`);
  sql(
    readFileSync(
      resolve(
        migrations,
        '20261006180000_uba_redvault_pilot_savings_and_expiry_guards.sql'
      ),
      'utf8'
    )
  );
  sql(`DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.customer_savings_redemptions'::regclass
        AND tgname = 'guard_uba_redvault_pilot_savings_redemption'
        AND tgenabled = 'O' AND tgtype = 23
    ) THEN RAISE EXCEPTION 'pilot_savings_redemption_guard_missing'; END IF;
    IF strpos(pg_get_functiondef('private.enforce_uba_redvault_private_pilot_expiry()'::regprocedure), 'uba_redvault_line_allocations') = 0 THEN
      RAISE EXCEPTION 'pilot_expiry_predicate_not_aligned';
    END IF;
  END $$;`);
  for (const part of [
    '20261006190000_uba_redvault_pilot_preserve_binding_after_disable.sql',
    '20261006190100_uba_redvault_pilot_preserved_binding_shipment_savings.sql',
    '20261006190200_uba_redvault_pilot_disabled_policy_staging_passthrough.sql',
    '20261006190300_uba_redvault_pilot_item_fulfillment_guard.sql',
    '20261006190400_uba_redvault_pilot_db_staging_mode.sql',
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
  END $$;`);
  process.stdout.write(
    'Ordered REDVAULT legacy and final-schema regression smoke passed.\n'
  );
}
