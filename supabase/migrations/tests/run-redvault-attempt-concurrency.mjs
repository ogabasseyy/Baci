import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(directory, '..');
const root = mkdtempSync(resolve(tmpdir(), 'baci-redvault-attempt-'));
const port = '55480';

function run(name, args, input) {
  const result = spawnSync(`/opt/homebrew/bin/${name}`, args, {
    encoding: 'utf8',
    input,
    timeout: 60000,
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

function concurrentSql(input) {
  return new Promise((resolveResult, reject) => {
    const process = spawn('/opt/homebrew/bin/psql', [
      '-X',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      root,
      '-p',
      port,
      '-U',
      'postgres',
      '-d',
      'postgres',
    ]);
    let output = '';
    let error = '';
    process.stdout.on('data', (value) => {
      output += value;
    });
    process.stderr.on('data', (value) => {
      error += value;
    });
    process.on('error', reject);
    process.on('close', (code) => {
      if (code === 0) resolveResult(output);
      else reject(new Error(error));
    });
    process.stdin.end(input);
  });
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
    `-k ${root} -p ${port} -c listen_addresses='' -c max_connections=12 -c shared_buffers=32MB`,
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
  ]) {
    sql(readFileSync(resolve(migrations, filename), 'utf8'));
  }
  sql(`
    BEGIN;
    INSERT INTO public.discount_codes(id, merchant_id, code, discount_type, discount_value, applies_to, is_active)
      VALUES ('22222222-2222-4222-8222-222222222222', '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'fixture', 'percentage', 5, 'all', true);
    INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current());
    INSERT INTO public.orders(id, merchant_id, customer_email, payment_method, payment_status, subtotal, discount_amount, total, tracking_token)
      VALUES ('11111111-1111-4111-8111-111111111111', '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'customer@example.test', 'uba_redvault', 'unpaid', 100, 5, 95, 'tracking-1');
    DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current();
    INSERT INTO private.uba_redvault_applications(
      id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash, quote_payload,
      customer_email, checkout_key, request_hash, discount_kobo, eligible_subtotal_kobo, status
    ) VALUES (
      '33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      '44444444-4444-4444-8444-444444444444', repeat('a', 64), '{"productSubtotalKobo":10000}'::jsonb,
      'customer@example.test', 'concurrency-fixture', repeat('b', 64), 500, 10000, 'pending'
    );
    UPDATE private.uba_redvault_runtime SET enabled = true, paystack_bank_code = '033';
    COMMIT;
  `);
  const claims = `{"storefront_redvault_customer_email":"customer@example.test","storefront_order_context":"route","storefront_order_merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74"}`;
  const summary = await concurrentSql(
    `SET request.jwt.claims = '${claims}'; SET ROLE authenticated; SELECT order_id,total,currency,tracking_token,product_subtotal_kobo,eligible_subtotal_kobo,ineligible_subtotal_kobo,discount_kobo,tax_kobo,shipping_kobo,gift_wrapping_kobo,payable_kobo,mixed_basket FROM public.get_storefront_redvault_checkout_summary('11111111-1111-4111-8111-111111111111');`
  );
  if (!summary.includes('11111111-1111-4111-8111-111111111111|95|NGN|tracking-1|10000|10000|0|500|0|0|0|9500|f')) {
    throw new Error(`persisted checkout summary was not returned: ${summary}`);
  }
  const reserveInput = `BEGIN; SELECT state FROM public.reserve_storefront_redvault_payment_attempt('11111111-1111-4111-8111-111111111111'); SELECT pg_sleep(0.2); COMMIT;`;
  const reserveResults = await Promise.all([1, 2].map(() => concurrentSql(`SET request.jwt.claims = '${claims}'; SET ROLE authenticated; ${reserveInput}`)));
  if (reserveResults.some((result) => !result.includes('created'))) {
    throw new Error(`concurrent reserve did not return the single created attempt: ${reserveResults.join('|')}`);
  }
  const attemptId = sql(`SELECT id FROM private.uba_redvault_payment_attempts;`).match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  )?.[0];
  if (!attemptId) throw new Error('concurrent reserve did not create exactly one attempt');
  const claimInput = `BEGIN; SELECT initialization_claimed FROM public.claim_storefront_redvault_payment_attempt_initialization('${attemptId}'); SELECT pg_sleep(0.2); COMMIT;`;
  const claimResults = await Promise.all([1, 2].map(() => concurrentSql(`SET request.jwt.claims = '${claims}'; SET ROLE authenticated; ${claimInput}`)));
  if (claimResults.filter((result) => result.includes('t')).length !== 1 || claimResults.filter((result) => result.includes('f')).length !== 1) {
    throw new Error(`concurrent initialization claim did not produce one winner: ${claimResults.join('|')}`);
  }
  process.stdout.write('Concurrent REDVAULT reserve produced one attempt and one initialization claim.\n');
} finally {
  if (running) run('pg_ctl', ['-D', resolve(root, 'data'), '-m', 'fast', '-w', 'stop']);
  rmSync(root, { force: true, recursive: true });
  process.stdout.write('Owned temporary cluster stopped and removed.\n');
}
