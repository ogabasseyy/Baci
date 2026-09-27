import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCaptureConcurrency } from './redvault-capture-concurrency.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(directory, '..');
const root = mkdtempSync(resolve(tmpdir(), 'baci-redvault-native-'));
chmodSync(root, 0o700);
const port = '55479';
function run(name, args, input) {
  const result = spawnSync(`/opt/homebrew/bin/${name}`, args, { input, encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0) throw new Error(`${name} failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
function sql(input) {
  return run('psql', ['-X','-v','ON_ERROR_STOP=1','-h',root,'-p',port,'-U','postgres','-d','postgres'], input);
}
let running = false;
try {
  run('initdb', ['-D',resolve(root,'data'),'-U','postgres','--auth=trust','--no-locale']);
  run('pg_ctl',['-D',resolve(root,'data'),'-l',resolve(root,'postgres.log'),'-o',`-k ${root} -p ${port} -c listen_addresses='' -c max_connections=12 -c shared_buffers=32MB`,'-w','start']);
  running = true;
  sql(readFileSync(resolve(directory,'redvault-native-fixture.sql'),'utf8'));
  const canonical = readFileSync(resolve(migrations,'20260828040000_bind_transaction_discount_proof_payload.sql'),'utf8');
  sql(canonical.slice(0,canonical.indexOf('CREATE OR REPLACE FUNCTION private.sanitize_')));
  const proof = readFileSync(resolve(migrations,'20260527064322_quiz_rpc_secret_private_config.sql'),'utf8');
  sql(proof.slice(proof.indexOf('CREATE OR REPLACE FUNCTION public.quiz_route_proof_valid('),proof.indexOf('CREATE OR REPLACE FUNCTION public.quiz_rpc_server_secret_configured')));
  sql(readFileSync(resolve(migrations,'20260721093205_harden_paid_order_completion_and_side_effect_retries.sql'),'utf8'));
  for (const filename of ['20260805173100_lock_merchant_invoice_exact_completion.sql','20260805190000_recheck_completed_merchant_invoice_exact_payments.sql','20260806000200_serialize_merchant_invoice_exact_claims.sql']) sql(readFileSync(resolve(migrations,filename),'utf8'));
  process.stdout.write('Loaded current gateway completion wrapper chain; merchant-invoice branches remain out of REDVAULT fixture scope.\n');
  const inventory = readFileSync(resolve(migrations,'20260615181534_serialized_variant_inventory.sql'),'utf8');
  const inventoryStart = inventory.indexOf('CREATE OR REPLACE FUNCTION private.confirm_order_inventory_reservations(');
  const inventoryEnd = inventory.indexOf('CREATE OR REPLACE FUNCTION private.mark_order_inventory_units_sold(', inventoryStart);
  sql(inventory.slice(inventoryStart, inventoryEnd));
  for (const filename of ['20260912090000_uba_redvault_discount_persistence.sql','20260912090100_uba_redvault_snapshot_binding.sql','20260912090200_uba_redvault_order_draft.sql','20260912090300_uba_redvault_proof_attachment.sql','20260912090400_uba_redvault_payment_completion.sql','20260912090500_uba_redvault_attempt_api.sql']) sql(readFileSync(resolve(migrations,filename),'utf8'));
  for (const filename of ['20260912090600_uba_redvault_capture_hold.sql', '20260912090700_uba_redvault_refund_lifecycle.sql', '20260912090800_uba_redvault_refund_reconciliation.sql', '20260912090900_uba_redvault_refund_capture_receipt_guard.sql']) sql(readFileSync(resolve(migrations,filename),'utf8'));
  sql(readFileSync(resolve(migrations,'20260912091000_uba_redvault_capture_lock_order.sql'),'utf8'));
  sql(readFileSync(resolve(migrations,'20260912091100_uba_redvault_refund_reconciliation_lease.sql'),'utf8'));
  sql(readFileSync(resolve(migrations,'20260912091300_uba_redvault_verified_completion.sql'),'utf8'));
  sql(readFileSync(resolve(migrations,'20260912091400_uba_redvault_verified_completion_hardening.sql'),'utf8'));
  sql(readFileSync(resolve(migrations,'20260912091500_uba_redvault_verified_completion_context.sql'),'utf8'));
  sql(readFileSync(resolve(migrations,'20260912091600_uba_redvault_atomic_inventory_completion.sql'),'utf8'));
  sql(readFileSync(resolve(migrations,'20260912091700_uba_redvault_null_transaction_state_guard.sql'),'utf8'));
  process.stdout.write(sql(readFileSync(resolve(directory,'redvault-native-checks.sql'),'utf8')));
  process.stdout.write(sql(readFileSync(resolve(directory,'redvault-capture-hold.sql'),'utf8')));
  process.stdout.write(sql(readFileSync(resolve(directory,'redvault-capture-replay.sql'),'utf8')));
  process.stdout.write(sql(readFileSync(resolve(directory,'redvault-verified-completion-914.sql'),'utf8')));
  process.stdout.write(sql(readFileSync(resolve(directory,'redvault-verified-completion-917.sql'),'utf8')));
  process.stdout.write(sql(readFileSync(resolve(directory,'redvault-verified-completion-916-malformed.sql'),'utf8')));
  sql(inventory.slice(inventoryStart, inventoryEnd));
  process.stdout.write(sql(readFileSync(resolve(directory,'redvault-verified-completion-916.sql'),'utf8')));
  await checkCaptureConcurrency(root, port, sql);
  process.stdout.write(sql(readFileSync(resolve(directory,'redvault-verified-completion.sql'),'utf8')));
  process.stdout.write(sql(readFileSync(resolve(directory,'redvault-refund-lifecycle-checks.sql'),'utf8')));
  process.stdout.write(sql(readFileSync(resolve(directory,'redvault-refund-reconciliation-lease.sql'),'utf8')));
  sql(`UPDATE public.test_input SET order_input = jsonb_set(order_input,'{checkout_idempotency_key}','"concurrent-new-key"');`);
  const concurrentInput = `SELECT set_config('request.jwt.claims','{"storefront_redvault_customer_email":"customer@example.test","storefront_order_context":"route","storefront_order_merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74"}',false); SET ROLE authenticated; SELECT public.create_storefront_redvault_order_draft(order_input,quote) FROM public.test_input;`;
  await Promise.all([1,2].map(() => new Promise((complete, fail) => {
    const process = spawn('/opt/homebrew/bin/psql',['-X','-v','ON_ERROR_STOP=1','-h',root,'-p',port,'-U','postgres','-d','postgres']);
    let error = '';
    process.stdout.resume();
    process.stderr.on('data', value => { error += value; });
    process.on('error',fail);
    process.on('close', code => code === 0 ? complete() : fail(new Error(error)));
    process.stdin.end(concurrentInput);
  })));
  sql(`DO $$ BEGIN IF (SELECT count(*) FROM public.orders) <> 2 OR (SELECT count(*) FROM private.uba_redvault_applications) <> 2 THEN RAISE EXCEPTION 'concurrent draft duplication'; END IF; END $$;`);
  process.stdout.write('Concurrent fresh-draft retries produced one additional order/application.\n');
  sql(readFileSync(resolve(migrations,'20260912091200_uba_redvault_tiered_snapshot_policy.sql'),'utf8'));
  process.stdout.write(sql(readFileSync(resolve(directory,'redvault-tiered-snapshot-policy.sql'),'utf8')));
} finally {
  if (running) run('pg_ctl',['-D',resolve(root,'data'),'-m','fast','-w','stop']);
  rmSync(root,{ recursive:true,force:true });
  process.stdout.write('Owned temporary cluster stopped and removed.\n');
}
