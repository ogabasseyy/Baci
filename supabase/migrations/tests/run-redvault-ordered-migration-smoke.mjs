import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkVerifiedCompletionConcurrency } from './redvault-verified-completion-concurrency.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(directory, '..');
const root = mkdtempSync(resolve(tmpdir(), 'baci-redvault-ordered-'));
const port = '55480';
chmodSync(root, 0o700);
function run(name, args, input) {
  const result = spawnSync(`/opt/homebrew/bin/${name}`, args, { input, encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0) throw new Error(`${name} failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
function sql(input) {
  return run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-h', root, '-p', port, '-U', 'postgres', '-d', 'postgres'], input);
}
let running = false;
try {
  run('initdb', ['-D', resolve(root, 'data'), '-U', 'postgres', '--auth=trust', '--no-locale']);
  run('pg_ctl', ['-D', resolve(root, 'data'), '-l', resolve(root, 'postgres.log'), '-o', `-k ${root} -p ${port} -c listen_addresses='' -c max_connections=12 -c shared_buffers=32MB`, '-w', 'start']);
  running = true;
  sql(readFileSync(resolve(directory, 'redvault-native-fixture.sql'), 'utf8'));
  const canonical = readFileSync(resolve(migrations, '20260828040000_bind_transaction_discount_proof_payload.sql'), 'utf8');
  sql(canonical.slice(0, canonical.indexOf('CREATE OR REPLACE FUNCTION private.sanitize_')));
  const proof = readFileSync(resolve(migrations, '20260527064322_quiz_rpc_secret_private_config.sql'), 'utf8');
  sql(proof.slice(proof.indexOf('CREATE OR REPLACE FUNCTION public.quiz_route_proof_valid('), proof.indexOf('CREATE OR REPLACE FUNCTION public.quiz_rpc_server_secret_configured')));
  for (const filename of ['20260721093205_harden_paid_order_completion_and_side_effect_retries.sql', '20260805173100_lock_merchant_invoice_exact_completion.sql', '20260805190000_recheck_completed_merchant_invoice_exact_payments.sql', '20260806000200_serialize_merchant_invoice_exact_claims.sql']) sql(readFileSync(resolve(migrations, filename), 'utf8'));
  sql("DO $$ BEGIN IF position('complete_order_gateway_payment_v1' IN pg_get_functiondef('public.complete_order_gateway_payment(uuid,uuid,jsonb,text)'::regprocedure)) = 0 THEN RAISE EXCEPTION 'ordered fixture did not load latest completion wrapper'; END IF; END $$;");
  const inventory = readFileSync(resolve(migrations, '20260615181534_serialized_variant_inventory.sql'), 'utf8');
  const inventoryStart = inventory.indexOf('CREATE OR REPLACE FUNCTION private.confirm_order_inventory_reservations(');
  const inventoryEnd = inventory.indexOf('CREATE OR REPLACE FUNCTION private.mark_order_inventory_units_sold(', inventoryStart);
  sql(inventory.slice(inventoryStart, inventoryEnd));
  const shipmentStart = inventory.indexOf('CREATE OR REPLACE FUNCTION private.apply_provider_shipment_webhook_status(');
  const shipmentEnd = inventory.indexOf('CREATE OR REPLACE FUNCTION private.release_expired_variant_inventory_reservations(', shipmentStart);
  sql(inventory.slice(shipmentStart, shipmentEnd));
  for (const filename of ['20260912090000_uba_redvault_discount_persistence.sql', '20260912090100_uba_redvault_snapshot_binding.sql', '20260912090200_uba_redvault_order_draft.sql', '20260912090300_uba_redvault_proof_attachment.sql', '20260912090400_uba_redvault_payment_completion.sql', '20260912090500_uba_redvault_attempt_api.sql', '20260912090600_uba_redvault_capture_hold.sql', '20260912090700_uba_redvault_refund_lifecycle.sql', '20260912090800_uba_redvault_refund_reconciliation.sql', '20260912090900_uba_redvault_refund_capture_receipt_guard.sql', '20260912091000_uba_redvault_capture_lock_order.sql', '20260912091100_uba_redvault_refund_reconciliation_lease.sql', '20260912091200_uba_redvault_tiered_snapshot_policy.sql', '20260912091300_uba_redvault_verified_completion.sql', '20260912091400_uba_redvault_verified_completion_hardening.sql', '20260912091500_uba_redvault_verified_completion_context.sql', '20260912091600_uba_redvault_atomic_inventory_completion.sql', '20260912091700_uba_redvault_null_transaction_state_guard.sql', '20260912091800_uba_redvault_postapproval_fulfillment.sql', '20260912091900_uba_redvault_postapproval_fulfillment_hardening.sql', '20260912092000_uba_redvault_inventory_snapshot_context.sql', '20260912092100_uba_redvault_item_membership_guard.sql', '20260912092200_uba_redvault_fk_indexes.sql', '20260912092300_uba_redvault_refund_fulfillment_hold.sql']) sql(readFileSync(resolve(migrations, filename), 'utf8'));
  let tieredChecks = readFileSync(resolve(directory, 'redvault-native-checks.sql'), 'utf8');
  tieredChecks = tieredChecks.replaceAll('"discount_amount":5', '"discount_amount":10').replaceAll('"discountKobo":500', '"discountKobo":1000').replaceAll('[500]', '[1000]').replaceAll('"allocationKobo":500', '"allocationKobo":1000').replaceAll("'percentage',5,'all'", "'percentage',10,'all'");
  process.stdout.write(sql(tieredChecks));
  process.stdout.write(sql(readFileSync(resolve(directory, 'redvault-capture-hold.sql'), 'utf8')));
  process.stdout.write(sql(readFileSync(resolve(directory, 'redvault-verified-completion-914.sql'), 'utf8')));
  process.stdout.write(sql(readFileSync(resolve(directory, 'redvault-verified-completion-917.sql'), 'utf8')));
  process.stdout.write(sql(readFileSync(resolve(directory, 'redvault-verified-completion-916-malformed.sql'), 'utf8')));
  sql(inventory.slice(inventoryStart, inventoryEnd));
  process.stdout.write(sql(readFileSync(resolve(directory, 'redvault-verified-completion-916.sql'), 'utf8')));
  process.stdout.write(sql(readFileSync(resolve(directory, 'redvault-fresh-approval-state-919.sql'), 'utf8')));
  await checkVerifiedCompletionConcurrency(root, port, sql);
  process.stdout.write(sql(readFileSync(resolve(directory, 'redvault-verified-completion.sql'), 'utf8')));
  process.stdout.write(sql(readFileSync(resolve(directory, 'redvault-postapproval-fulfillment-919.sql'), 'utf8')));
  process.stdout.write(sql(readFileSync(resolve(directory, 'redvault-full-refund-fulfillment-hold-923.sql'), 'utf8')));
  process.stdout.write(sql(readFileSync(resolve(directory, 'redvault-item-membership-921.sql'), 'utf8')));
  process.stdout.write(sql(readFileSync(resolve(directory, 'redvault-fk-indexes-922.sql'), 'utf8')));
  process.stdout.write(sql(readFileSync(resolve(directory, 'redvault-current-tree-replay.sql'), 'utf8')));
  process.stdout.write('Ordered 900-923 tiered draft, attempt, capture, approval, and fulfillment smoke passed.\n');
} finally {
  if (running) run('pg_ctl', ['-D', resolve(root, 'data'), '-m', 'fast', '-w', 'stop']);
  rmSync(root, { recursive: true, force: true });
  process.stdout.write('Ordered temporary cluster stopped and removed.\n');
}
