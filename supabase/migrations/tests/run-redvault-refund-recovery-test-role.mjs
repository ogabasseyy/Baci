import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const directory = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(directory, '..');
const root = mkdtempSync(resolve(tmpdir(), 'baci-redvault-refund-role-'));
const port = '55481';

function run(name, args, input) {
  const result = spawnSync(`/opt/homebrew/bin/${name}`, args, {
    encoding: 'utf8',
    input,
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`${name} failed: ${result.stderr}\n${result.stdout}`);
  }
  return result.stdout;
}

function sql(input) {
  return run(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-h', root, '-p', port, '-U', 'postgres', '-d', 'postgres'],
    input
  );
}

let running = false;
try {
  chmodSync(root, 0o700);
  run('initdb', ['-D', resolve(root, 'data'), '-U', 'postgres', '--auth=trust', '--no-locale']);
  run('pg_ctl', [
    '-D',
    resolve(root, 'data'),
    '-l',
    resolve(root, 'postgres.log'),
    '-o',
    `-k ${root} -p ${port} -c listen_addresses='' -c shared_buffers=32MB`,
    '-w',
    'start',
  ]);
  running = true;
  sql(readFileSync(resolve(directory, 'redvault-native-fixture.sql'), 'utf8'));
  const canonical = readFileSync(
    resolve(migrations, '20260828040000_bind_transaction_discount_proof_payload.sql'),
    'utf8'
  );
  sql(canonical.slice(0, canonical.indexOf('CREATE OR REPLACE FUNCTION private.sanitize_')));
  const proof = readFileSync(
    resolve(migrations, '20260527064322_quiz_rpc_secret_private_config.sql'),
    'utf8'
  );
  sql(
    proof.slice(
      proof.indexOf('CREATE OR REPLACE FUNCTION public.quiz_route_proof_valid('),
      proof.indexOf('CREATE OR REPLACE FUNCTION public.quiz_rpc_server_secret_configured')
    )
  );
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
    '20260912091300_uba_redvault_verified_completion.sql',
  ]) {
    sql(readFileSync(resolve(migrations, filename), 'utf8'));
  }
  sql(readFileSync(resolve(directory, 'redvault-native-checks.sql'), 'utf8'));
  sql(readFileSync(resolve(directory, 'redvault-capture-hold.sql'), 'utf8'));
  process.stdout.write(
    sql(readFileSync(resolve(directory, 'redvault-refund-recovery-test-role.sql'), 'utf8'))
  );
} finally {
  if (running) run('pg_ctl', ['-D', resolve(root, 'data'), '-m', 'fast', '-w', 'stop']);
  rmSync(root, { force: true, recursive: true });
  process.stdout.write('Owned temporary cluster stopped and removed.\n');
}
