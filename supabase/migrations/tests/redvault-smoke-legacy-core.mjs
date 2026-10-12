import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractRedvaultInventoryRelease } from './extract-redvault-inventory-release.mjs';

// Replays the pre-pilot fixture and legacy REDVAULT migrations, then runs
// the tiered-pricing checks. Returns the inventory slices the later legacy
// checks re-apply.
export function replaySmokeLegacyCore({ directory, migrations, sql }) {
  sql(readFileSync(resolve(directory, 'redvault-native-fixture.sql'), 'utf8'));
  sql(
    'ALTER TABLE public.orders ADD COLUMN shipment_booking_lock_token uuid, ADD COLUMN shipment_booking_started_at timestamptz;'
  );
  const settlement = readFileSync(
    resolve(
      migrations,
      '20260510170000_payment_rpc_null_safe_role_guards_and_tenant_scope.sql'
    ),
    'utf8'
  );
  const settlementStart = settlement.indexOf(
    'CREATE OR REPLACE FUNCTION public.record_merchant_settlement('
  );
  const settlementEnd = settlement.indexOf(
    '-- ---------- Δ-87: claim_payment_side_effect ----------',
    settlementStart
  );
  sql(settlement.slice(settlementStart, settlementEnd));
  const baseline = readFileSync(
    resolve(migrations, '20260418000000_baseline.sql'),
    'utf8'
  );
  const processSettlementsStart = baseline.indexOf(
    'CREATE OR REPLACE FUNCTION "public"."process_due_settlements"()'
  );
  const processSettlementsEnd = baseline.indexOf(
    'ALTER FUNCTION "public"."process_due_settlements"()',
    processSettlementsStart
  );
  sql(baseline.slice(processSettlementsStart, processSettlementsEnd));
  sql(
    readFileSync(
      resolve(migrations, '20260723000010_transactions_refund_statuses.sql'),
      'utf8'
    )
  );
  const canonical = readFileSync(
    resolve(
      migrations,
      '20260828040000_bind_transaction_discount_proof_payload.sql'
    ),
    'utf8'
  );
  sql(
    canonical.slice(
      0,
      canonical.indexOf('CREATE OR REPLACE FUNCTION private.sanitize_')
    )
  );
  const proof = readFileSync(
    resolve(migrations, '20260527064322_quiz_rpc_secret_private_config.sql'),
    'utf8'
  );
  sql(
    proof.slice(
      proof.indexOf(
        'CREATE OR REPLACE FUNCTION public.quiz_route_proof_valid('
      ),
      proof.indexOf(
        'CREATE OR REPLACE FUNCTION public.quiz_rpc_server_secret_configured'
      )
    )
  );
  for (const filename of [
    '20260721093205_harden_paid_order_completion_and_side_effect_retries.sql',
    '20260805173100_lock_merchant_invoice_exact_completion.sql',
    '20260805190000_recheck_completed_merchant_invoice_exact_payments.sql',
    '20260806000200_serialize_merchant_invoice_exact_claims.sql',
  ])
    sql(readFileSync(resolve(migrations, filename), 'utf8'));
  sql(
    "DO $$ BEGIN IF position('complete_order_gateway_payment_v1' IN pg_get_functiondef('public.complete_order_gateway_payment(uuid,uuid,jsonb,text)'::regprocedure)) = 0 THEN RAISE EXCEPTION 'ordered fixture did not load latest completion wrapper'; END IF; END $$;"
  );
  const inventory = readFileSync(
    resolve(migrations, '20260615181534_serialized_variant_inventory.sql'),
    'utf8'
  );
  sql(extractRedvaultInventoryRelease(inventory));
  const inventoryStart = inventory.indexOf(
    'CREATE OR REPLACE FUNCTION private.confirm_order_inventory_reservations('
  );
  const inventoryEnd = inventory.indexOf(
    'CREATE OR REPLACE FUNCTION private.mark_order_inventory_units_sold(',
    inventoryStart
  );
  sql(inventory.slice(inventoryStart, inventoryEnd));
  const shipmentStart = inventory.indexOf(
    'CREATE OR REPLACE FUNCTION private.apply_provider_shipment_webhook_status('
  );
  const shipmentEnd = inventory.indexOf(
    'CREATE OR REPLACE FUNCTION private.release_expired_variant_inventory_reservations(',
    shipmentStart
  );
  sql(inventory.slice(shipmentStart, shipmentEnd));
  for (const filename of [
    '20260912090000_uba_redvault_discount_persistence.sql',
    '20260912090100_uba_redvault_snapshot_binding.sql',
    '20260912090200_uba_redvault_order_draft.sql',
    '20260912090300_uba_redvault_proof_attachment.sql',
    '20260912090400_uba_redvault_payment_completion.sql',
    '20260912090500_uba_redvault_attempt_api.sql',
    '20260912090600_uba_redvault_capture_hold.sql',
    '20260912090700_uba_redvault_refund_lifecycle.sql',
    '20260912090800_uba_redvault_refund_reconciliation.sql',
    '20260912090900_uba_redvault_refund_capture_receipt_guard.sql',
    '20260912091000_uba_redvault_capture_lock_order.sql',
    '20260912091100_uba_redvault_refund_reconciliation_lease.sql',
    '20260912091200_uba_redvault_tiered_snapshot_policy.sql',
    '20260912091300_uba_redvault_verified_completion.sql',
    '20260912091400_uba_redvault_verified_completion_hardening.sql',
    '20260912091500_uba_redvault_verified_completion_context.sql',
    '20260912091600_uba_redvault_atomic_inventory_completion.sql',
    '20260912091700_uba_redvault_null_transaction_state_guard.sql',
    '20260912091800_uba_redvault_postapproval_fulfillment.sql',
    '20260912091900_uba_redvault_postapproval_fulfillment_hardening.sql',
    '20260912092000_uba_redvault_inventory_snapshot_context.sql',
    '20260912092100_uba_redvault_item_membership_guard.sql',
    '20260912092200_uba_redvault_fk_indexes.sql',
    '20260912092300_uba_redvault_refund_fulfillment_hold.sql',
  ])
    sql(readFileSync(resolve(migrations, filename), 'utf8'));
  let tieredChecks = readFileSync(
    resolve(directory, 'redvault-native-checks.sql'),
    'utf8'
  );
  tieredChecks = tieredChecks
    .replaceAll('"discount_amount":5', '"discount_amount":10')
    .replaceAll('"discountKobo":500', '"discountKobo":1000')
    .replaceAll('[500]', '[1000]')
    .replaceAll('"allocationKobo":500', '"allocationKobo":1000')
    .replaceAll("'percentage',5,'all'", "'percentage',10,'all'");
  process.stdout.write(sql(tieredChecks));

  return { inventory, inventoryEnd, inventoryStart };
}
