import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Runs only against a disposable local container: no host ports, credentials,
// Supabase project, or production database connection are used.
const directory = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(directory, '../migrations');
const container = `baci-shipment-permissions-${process.pid}`;
const beforeFix = process.argv.includes('--before-fix');
const migration = readdirSync(migrations).find((name) =>
  name.endsWith('_fix_shipment_booking_refund_probe_permissions.sql')
);

function docker(args, input) {
  const result = spawnSync('docker', args, {
    input,
    encoding: 'utf8',
    timeout: 60000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? result.stderr ?? result.stdout);
  }
  return result.stdout;
}

function sql(input) {
  return docker(
    [
      'exec',
      '-i',
      container,
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'postgres',
    ],
    input
  );
}

function readMigration(name) {
  return readFileSync(resolve(migrations, name), 'utf8');
}

function extractFunction(source, name) {
  const quoted = `"public"."${name}"`;
  const plain = `public.${name}`;
  let start = source.indexOf(`CREATE OR REPLACE FUNCTION ${plain}(`);
  if (start < 0)
    start = source.indexOf(`CREATE OR REPLACE FUNCTION ${quoted}(`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  const body = source.slice(start);
  const delimiter = /AS (\$[a-z_]*\$)/i.exec(body);
  if (!delimiter) throw new Error(`Missing SQL body for ${name}`);
  const end = body.indexOf(
    `${delimiter[1]};`,
    delimiter.index + delimiter[0].length
  );
  if (end < 0) throw new Error(`Unterminated function ${name}`);
  return body.slice(0, end + delimiter[1].length + 1);
}

try {
  docker([
    'run',
    '--rm',
    '--name',
    container,
    '--network',
    'none',
    '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    '-d',
    'postgres:17-alpine',
    '-c',
    'listen_addresses=',
  ]);
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const logs = docker(['logs', container]);
      if (logs.includes('PostgreSQL init process complete')) {
        sql('SELECT 1;');
        break;
      }
    } catch {
      // The temporary server is still starting.
    }
    if (attempt === 29) throw new Error('Temporary PostgreSQL did not start');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
  sql(
    readFileSync(
      resolve(directory, 'order_shipment_booking_permissions_fixture.sql'),
      'utf8'
    )
  );
  const baseline = readMigration('20260418000000_baseline.sql');
  sql(extractFunction(baseline, 'has_merchant_access'));
  sql(readMigration('20260724000001_deep_merge_get_staff_permissions.sql'));
  sql(readMigration('20260705143000_align_staff_permission_all_grants.sql'));
  sql(
    extractFunction(
      readMigration('20260504010000_can_access_order_helper.sql'),
      'can_access_order'
    )
  );
  const policies = readMigration(
    '20260611233642_consolidate_permissive_rls_policies.sql'
  );
  for (const name of ['orders_select_policy', 'orders_update_policy']) {
    const start = policies.indexOf(`CREATE POLICY ${name}\n`);
    if (start < 0) throw new Error(`Missing ${name}`);
    sql(policies.slice(start, policies.indexOf(';', start) + 1));
  }
  const refundGuard = readMigration(
    '20260915102900_uba_redvault_round29_review_fixes.sql'
  );
  sql(
    refundGuard.slice(
      0,
      refundGuard.indexOf(
        'CREATE OR REPLACE FUNCTION public.claim_order_shipment_booking('
      )
    )
  );
  sql(
    extractFunction(
      readMigration('20260915103400_uba_redvault_round34_review_fixes.sql'),
      'claim_order_shipment_booking'
    )
  );
  sql(
    'REVOKE ALL ON FUNCTION public.claim_order_shipment_booking(uuid,uuid,uuid,integer) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.claim_order_shipment_booking(uuid,uuid,uuid,integer) TO authenticated, service_role;'
  );
  if (!beforeFix) {
    if (!migration)
      throw new Error(
        'Shipment booking permission repair migration is missing'
      );
    sql(readMigration(migration));
  }
  process.stdout.write(
    sql(
      [
        'order_shipment_booking_permissions_assertions.sql',
        'order_shipment_booking_refund_probe_assertions.sql',
      ]
        .map((name) => readFileSync(resolve(directory, name), 'utf8'))
        .join('\n')
    )
  );
  process.stdout.write(
    'Shipment booking PostgreSQL permission regressions passed.\n'
  );
} finally {
  spawnSync('docker', ['rm', '-f', container], { encoding: 'utf8' });
}
