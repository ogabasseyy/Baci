import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { officialStorageBootstrap } from './official-storage-bootstrap.mjs';

function fixture() {
  return {
    observedAt: '2026-09-14T12:00:00Z', reviewed: true,
    db: { id: 'a'.repeat(64), image: 'supabase/postgres:17.6.1.136', project: 'baci-isolated-savings', service: 'db', healthy: true, networkId: 'b'.repeat(64) },
    network: { id: 'b'.repeat(64), name: 'baci-isolated-savings_database', project: 'baci-isolated-savings', internal: true, bridge: 'baci-stg-db' },
  };
}

const now = Date.parse('2026-09-14T12:00:00Z');
const sql = (name) => readFileSync(new URL(`./official-storage-bootstrap-${name}.sql`, import.meta.url), 'utf8');

test('uses the official pinned migration entrypoint without starting Storage HTTP or additional services', () => {
  const config = officialStorageBootstrap(fixture(), now);
  assert.deepEqual(Object.keys(config.services), ['storage-bootstrap']);
  const worker = config.services['storage-bootstrap'];
  assert.equal(worker.image, 'supabase/storage-api:v1.74.0');
  assert.deepEqual(worker.command, ['node', 'dist/scripts/migrate-call.js']);
  assert.equal(worker.working_dir, '/app');
  assert.equal(worker.restart, 'no');
  assert.equal(worker.ports, undefined);
  assert.equal(worker.volumes, undefined);
  assert.equal(worker.depends_on, undefined);
  assert.equal(worker.logging.driver, 'none');
  assert.equal(worker.read_only, true);
  assert.deepEqual(worker.networks, ['database']);
  assert.deepEqual(config.networks.database, { external: true, name: 'baci-isolated-savings_database' });
});

test('uses a distinct scoped credential and disables role installation, hash rewriting and external features', () => {
  const settings = officialStorageBootstrap(fixture(), now).services['storage-bootstrap'].environment;
  assert.match(settings.DATABASE_URL, /^postgres:\/\/baci_storage_initializer:\$\{ISOLATED_STORAGE_DB_PASSWORD:\?.*\}@db:5432\/postgres$/);
  assert.doesNotMatch(JSON.stringify(settings), /ISOLATED_POSTGRES_PASSWORD|ISOLATED_AUTH_DB_PASSWORD|ISOLATED_REST_DB_PASSWORD|supabase\.co/);
  assert.equal(settings.DB_INSTALL_ROLES, 'false');
  assert.equal(settings.DB_ALLOW_MIGRATION_REFRESH, 'false');
  assert.equal(settings.DB_SUPER_USER, 'baci_storage_initializer');
  for (const key of ['MULTI_TENANT', 'PG_QUEUE_ENABLE', 'VECTOR_STORE_MIGRATIONS_ENABLED', 'VECTOR_DATABASE_CREATE', 'ENABLE_IMAGE_TRANSFORMATION']) assert.equal(settings[key], 'false');
  assert.equal(settings.STORAGE_BACKEND, 'file');
});

test('rejects stale, unreviewed, wrong-project, wrong-image and noninternal inventory', () => {
  for (const mutate of [
    (evidence) => { evidence.reviewed = false; },
    (evidence) => { evidence.observedAt = '2026-09-14T11:00:00Z'; },
    (evidence) => { evidence.db.image = 'supabase/postgres:latest'; },
    (evidence) => { evidence.db.project = 'production'; },
    (evidence) => { evidence.network.internal = false; },
    (evidence) => { evidence.network.name = 'default'; },
    (evidence) => { evidence.db.networkId = 'c'.repeat(64); },
    (evidence) => { evidence.db.healthy = false; },
  ]) {
    const evidence = fixture();
    mutate(evidence);
    assert.throws(() => officialStorageBootstrap(evidence, now));
  }
});

test('administrative preparation creates only a limited principal and empty schema, never fake Storage tables', () => {
  const prepare = sql('prepare');
  assert.match(prepare, /NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/);
  assert.match(prepare, /ISOLATED_STORAGE_DB_PASSWORD/);
  assert.match(prepare, /format\('ALTER ROLE baci_storage_initializer PASSWORD %L'/);
  assert.match(prepare, /Initializer already exists/);
  assert.match(prepare, /Storage schema is not empty/);
  assert.match(prepare, /170006/);
  assert.doesNotMatch(prepare, /CREATE TABLE|CREATE OR REPLACE FUNCTION|GRANT postgres|ALTER ROLE supabase_storage_admin|ALTER USER supabase_storage_admin/);
});

test('lockdown removes login/password and live sessions; verification checks official tables, RLS and completion', () => {
  assert.match(sql('lockdown'), /NOLOGIN PASSWORD NULL/);
  assert.match(sql('lockdown'), /pg_terminate_backend/);
  for (const pattern of [/relrowsecurity/, /storage\.objects/, /storage\.buckets/, /validate-bucket-lifecycle-constraints/, /Unexpected Storage data/]) assert.match(sql('verify'), pattern);
});
