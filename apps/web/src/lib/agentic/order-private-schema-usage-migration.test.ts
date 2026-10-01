import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, '../../../../../');
const migrationsDirectory = resolve(repositoryRoot, 'supabase/migrations');
const migrationFilePattern = /^\d{14}.*\.sql$/;
const statementPattern =
  /(GRANT\s+USAGE\s+ON\s+SCHEMA\s+private\s+TO|REVOKE\s+(?:ALL|USAGE)\s+ON\s+SCHEMA\s+private\s+FROM)\s+([^;]+);/gi;

function applyPrivateSchemaUsageStatements(
  sql: string,
  usage: Map<string, boolean>
) {
  for (const match of sql.matchAll(statementPattern)) {
    const hasUsage = match[1].toUpperCase().startsWith('GRANT');
    const roles = match[2].split(',').map((role) => role.trim());

    for (const role of roles) {
      if (usage.has(role)) {
        usage.set(role, hasUsage);
      }
    }
  }
}

function replayPrivateSchemaUsage() {
  const usage = new Map([
    ['anon', false],
    ['authenticated', false],
    ['service_role', false],
  ]);

  for (const fileName of readdirSync(migrationsDirectory)
    .filter((file) => migrationFilePattern.test(file))
    .sort()) {
    const sql = readFileSync(resolve(migrationsDirectory, fileName), 'utf8');

    applyPrivateSchemaUsageStatements(sql, usage);
  }

  return usage;
}

function readUsageRepairMigration() {
  const fileName = readdirSync(migrationsDirectory).find((file) =>
    file.endsWith('_restore_storefront_order_private_schema_usage.sql')
  );

  if (!fileName) {
    throw new Error(
      'Storefront private-schema usage repair migration is missing'
    );
  }

  return readFileSync(resolve(migrationsDirectory, fileName), 'utf8');
}

function readBoundaryRepairMigrations() {
  const fileNames = readdirSync(migrationsDirectory)
    .filter(
      (file) =>
        file.endsWith('_harden_storefront_order_private_schema_boundary.sql') ||
        file.endsWith('_harden_authenticated_private_schema_delegates.sql')
    )
    .sort();

  if (fileNames.length === 0) {
    throw new Error(
      'Storefront private-schema boundary repair migration is missing'
    );
  }

  return fileNames
    .map((fileName) =>
      readFileSync(resolve(migrationsDirectory, fileName), 'utf8')
    )
    .join('\n');
}

describe('bugfix: public checkout wrappers lost private-schema usage', () => {
  it('replays usage-only schema revocations as access removal', () => {
    const usage = new Map([['anon', true]]);

    applyPrivateSchemaUsageStatements(
      'REVOKE USAGE ON SCHEMA private FROM anon;',
      usage
    );

    expect(usage.get('anon')).toBe(false);
  });

  it('keeps anonymous compatibility while preserving the authenticated private-schema boundary', () => {
    const usage = replayPrivateSchemaUsage();

    expect(usage.get('anon')).toBe(true);
    expect(usage.get('authenticated')).toBe(false);
    expect(usage.get('service_role')).toBe(true);
  });

  it('moves the authenticated checkout wrapper behind the function-owner boundary', () => {
    const migrationSql = readBoundaryRepairMigrations();

    expect(migrationSql).toMatch(
      /ALTER\s+FUNCTION\s+public\.create_storefront_order\([\s\S]*?\)\s+SECURITY\s+DEFINER/i
    );
    expect(migrationSql).toMatch(
      /ALTER\s+FUNCTION\s+public\.create_storefront_order\([\s\S]*?\)\s+SET\s+search_path\s*=\s*''/i
    );
    expect(migrationSql).toMatch(
      /REVOKE\s+USAGE\s+ON\s+SCHEMA\s+private\s+FROM\s+authenticated\s*;/i
    );
    expect(migrationSql).toContain(
      "function_definition.prosrc LIKE '%private.%'"
    );
    expect(migrationSql).toContain(
      'Functions with declarations or other statements require'
    );
    expect(migrationSql).toMatch(
      /CASE\s+function_language\.lanname[\s\S]*WHEN\s+'sql'[\s\S]*WHEN\s+'plpgsql'[\s\S]*ELSE\s+FALSE/i
    );
    expect(migrationSql).toContain("SET search_path = %L', v_wrapper, ''");
    expect(migrationSql).toMatch(
      /has_function_privilege\(\s*'authenticated',\s*function_definition\.oid,\s*'EXECUTE'/
    );
  });

  it('keeps direct browser and service-role access to the credential vault revoked', () => {
    const migrationSql = readUsageRepairMigration();

    expect(migrationSql).toMatch(
      /REVOKE\s+ALL\s+ON\s+TABLE\s+private\.merchant_payment_credentials\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role\s*;/i
    );
    expect(migrationSql).not.toMatch(
      /GRANT[^;]*ON\s+TABLE\s+private\.merchant_payment_credentials/i
    );
  });

  it('runs the replay regression whenever quiz database files change', () => {
    const workflow = readFileSync(
      resolve(repositoryRoot, '.github/workflows/ci.yml'),
      'utf8'
    );
    const filters = readFileSync(
      resolve(repositoryRoot, '.github/filters/ci.yml'),
      'utf8'
    );

    expect(workflow).toMatch(
      /quality-db-replay:[\s\S]*?if: needs\.changes\.outputs\.quiz_db == 'true'[\s\S]*?- name: Run migration replay regression test\s+run: pnpm --filter @baci\/web exec vitest run src\/lib\/agentic\/order-private-schema-usage-migration\.test\.ts/
    );
    expect(filters).toContain(
      "'supabase/tests/storefront_order_private_schema_boundary*.sql'"
    );
    expect(filters).toContain(
      "'supabase/tests/run-storefront-order-private-schema-boundary-test.sh'"
    );
  });

  it('authenticates every TCP psql command in the PostgreSQL boundary runner', () => {
    const runner = readFileSync(
      resolve(
        repositoryRoot,
        'supabase/tests/run-storefront-order-private-schema-boundary-test.sh'
      ),
      'utf8'
    );

    expect(runner).toContain('postgres_password="test"');
    expect(runner).not.toMatch(/docker exec(?! -e PGPASSWORD=)/);
  });
});
