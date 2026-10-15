import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(directory, '../migrations');

// No network, exposed port, project credentials, or live carrier calls.
export function createShippingQuoteProofTestDatabase({
  beforeFix = false,
} = {}) {
  const container = `baci-quote-proof-${process.pid}-${randomUUID().slice(0, 8)}`;

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

  function query(input) {
    return docker(
      [
        'exec',
        '-i',
        container,
        'psql',
        '-X',
        '-qAt',
        '-v',
        'ON_ERROR_STOP=1',
        '-v',
        'VERBOSITY=verbose',
        '-U',
        'postgres',
        '-d',
        'postgres',
      ],
      input
    );
  }

  /** @returns {Promise<string>} */
  function queryAsync(input) {
    return new Promise((resolveQuery, reject) => {
      const process = spawn('docker', [
        'exec',
        '-i',
        container,
        'psql',
        '-X',
        '-qAt',
        '-v',
        'ON_ERROR_STOP=1',
        '-v',
        'VERBOSITY=verbose',
        '-U',
        'postgres',
        '-d',
        'postgres',
      ]);
      let output = '';
      let errors = '';
      const timeout = setTimeout(() => process.kill('SIGKILL'), 30000);
      process.stdout.on('data', (chunk) => {
        output += chunk;
      });
      process.stderr.on('data', (chunk) => {
        errors += chunk;
      });
      process.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      process.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolveQuery(output);
        else reject(new Error(errors || `psql exited ${code}`));
      });
      process.stdin.end(input);
    });
  }

  function readMigration(name) {
    return readFileSync(resolve(migrations, name), 'utf8');
  }

  function definition(source, schema, name) {
    let start = source.indexOf(`CREATE OR REPLACE FUNCTION ${schema}.${name}(`);
    if (start < 0)
      start = source.indexOf(
        `CREATE OR REPLACE FUNCTION "${schema}"."${name}"(`
      );
    if (start < 0) throw new Error(`Missing ${schema}.${name}`);
    const body = source.slice(start);
    const delimiter = /AS (\$[a-z_]*\$)/i.exec(body);
    if (!delimiter) throw new Error(`Missing body for ${name}`);
    const end = body.indexOf(
      `${delimiter[1]};`,
      delimiter.index + delimiter[0].length
    );
    if (end < 0) throw new Error(`Unterminated ${name}`);
    return body.slice(0, end + delimiter[1].length + 1);
  }

  async function start() {
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
        if (
          docker(['logs', container]).includes(
            'PostgreSQL init process complete'
          )
        ) {
          query('SELECT 1;');
          break;
        }
      } catch {
        // The isolated server is still starting.
      }
      if (attempt === 29) throw new Error('Temporary PostgreSQL did not start');
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
    }
    query(
      readFileSync(
        resolve(directory, 'order_shipment_booking_permissions_fixture.sql'),
        'utf8'
      )
    );
    query(
      readFileSync(
        resolve(directory, 'shipping_quote_proof_fixture.sql'),
        'utf8'
      )
    );
    query(
      definition(
        readMigration('20260418000000_baseline.sql'),
        'public',
        'has_merchant_access'
      )
    );
    query(readMigration('20260724000001_deep_merge_get_staff_permissions.sql'));
    query(
      readMigration('20260705143000_align_staff_permission_all_grants.sql')
    );
    const original = readMigration(
      '20260903135000_attest_shipping_quote_writes_and_shipment_grants.sql'
    );
    query(definition(original, 'private', 'verify_shipping_quote_route_proof'));
    query(
      readMigration(
        '20260904123300_preserve_customer_checkout_on_quote_refresh.sql'
      )
    );
    query(
      definition(original, 'public', 'persist_refreshed_order_shipping_quote')
    );
    // Replicate the production ACLs before CREATE OR REPLACE so the repair
    // must preserve them, rather than accidentally granting client access.
    query(`
      REVOKE ALL ON FUNCTION private.verify_shipping_quote_route_proof(jsonb,text,uuid,uuid)
        FROM PUBLIC, anon, authenticated, service_role;
      REVOKE ALL ON FUNCTION public.persist_refreshed_order_shipping_quote(uuid,jsonb)
        FROM PUBLIC, anon, authenticated;
      REVOKE ALL ON FUNCTION public.persist_refreshed_order_shipping_quote(uuid,jsonb,jsonb)
        FROM PUBLIC, anon;
      GRANT EXECUTE ON FUNCTION public.persist_refreshed_order_shipping_quote(uuid,jsonb,jsonb)
        TO authenticated;
    `);
    if (!beforeFix) {
      const migration = readdirSync(migrations).find((name) =>
        name.endsWith('_fix_shipping_quote_proof_canonicalization.sql')
      );
      if (!migration)
        throw new Error('Quote proof repair migration is missing');
      query(readMigration(migration));
    }
  }

  function stop() {
    spawnSync('docker', ['rm', '-f', container], {
      encoding: 'utf8',
      timeout: 30000,
    });
  }

  return { query, queryAsync, start, stop };
}
