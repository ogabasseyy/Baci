import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261028010000_cache_invalidation_worker_capability.sql', import.meta.url),
  'utf8'
);
const roleSetup = migration.slice(migration.indexOf('DO $$'), migration.indexOf('GRANT USAGE ON SCHEMA public'));

function postgresServer(bootstrapRole, callback) {
  const bin = process.env.PG_BIN ?? execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
  for (const binary of ['initdb', 'pg_ctl', 'psql']) accessSync(join(bin, binary), constants.X_OK);
  const directory = mkdtempSync(join(tmpdir(), 'baci-cache-worker-role-'));
  let started = false;
  const run = (binary, args) => execFileSync(join(bin, binary), args, { encoding: 'utf8', stdio: 'pipe' });
  const execute = (role, sql) => execFileSync(join(bin, 'psql'), [
    '-X', '-v', 'ON_ERROR_STOP=1', '-qAt', '-h', directory, '-p', '5432', '-U', role,
    '-d', 'postgres',
  ], { input: sql, encoding: 'utf8', stdio: 'pipe' });

  try {
    run('initdb', ['-D', join(directory, 'data'), '-A', 'trust', '--no-locale', '-U', bootstrapRole]);
    run('pg_ctl', [
      '-D', join(directory, 'data'), '-l', join(directory, 'postgres.log'),
      '-o', `-k ${directory} -h '' -p 5432`, '-w', 'start',
    ]);
    started = true;
    callback({ bin, directory, execute, run, bootstrapRole });
  } finally {
    if (started) run('pg_ctl', ['-D', join(directory, 'data'), '-m', 'immediate', '-w', 'stop']);
    rmSync(directory, { recursive: true, force: true });
  }
}

function executeAs(bin, directory, role, sql) {
  return execFileSync(join(bin, 'psql'), [
    '-X', '-v', 'ON_ERROR_STOP=1', '-qAt', '-h', directory, '-p', '5432', '-U', role,
    '-d', 'postgres',
  ], { input: sql, encoding: 'utf8', stdio: 'pipe' });
}

function expectRoleSetupFailure(bin, directory, role, sql, expectedMessage) {
  let output = '';
  try {
    executeAs(bin, directory, role, sql);
  } catch (error) {
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
  assert.match(output, new RegExp(expectedMessage));
}

test('the production CREATEROLE postgres creator row is narrowly accepted', () => {
  postgresServer('supabase_admin', ({ bin, directory }) => {
    executeAs(bin, directory, 'supabase_admin', `
      CREATE ROLE postgres LOGIN CREATEROLE NOSUPERUSER NOCREATEDB NOREPLICATION NOBYPASSRLS;
      CREATE ROLE authenticator NOLOGIN;
    `);
    executeAs(bin, directory, 'postgres', roleSetup);

    const identity = executeAs(bin, directory, 'postgres', 'SELECT current_user || \'|\' || session_user;').trim();
    assert.equal(identity, 'postgres|postgres');
    const attributes = executeAs(bin, directory, 'supabase_admin', `
      SELECT rolsuper || '|' || rolcreatedb || '|' || rolcreaterole || '|'
        || rolreplication || '|' || rolbypassrls || '|' || rolcanlogin || '|'
        || rolinherit || '|' || rolconnlimit
      FROM pg_catalog.pg_roles WHERE rolname = 'cache_invalidation_worker';
    `).trim();
    assert.equal(attributes, 'false|false|false|false|false|false|false|-1');

    const membership = executeAs(bin, directory, 'supabase_admin', `
      SELECT member.rolname || '|' || am.admin_option || '|' || am.inherit_option
        || '|' || am.set_option || '|' || grantor.rolname || '|' || grantor.rolsuper
      FROM pg_catalog.pg_auth_members AS am
      JOIN pg_catalog.pg_roles AS granted ON granted.oid = am.roleid
      JOIN pg_catalog.pg_roles AS member ON member.oid = am.member
      JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = am.grantor
      WHERE granted.rolname = 'cache_invalidation_worker';
    `).trim();
    assert.equal(membership, 'postgres|true|false|false|supabase_admin|true');
    const authenticatorMembers = executeAs(bin, directory, 'supabase_admin', `
      SELECT count(*) FROM pg_catalog.pg_auth_members AS am
      JOIN pg_catalog.pg_roles AS granted ON granted.oid = am.roleid
      JOIN pg_catalog.pg_roles AS member ON member.oid = am.member
      WHERE granted.rolname = 'cache_invalidation_worker'
        AND member.rolname = 'authenticator';
    `).trim();
    assert.equal(authenticatorMembers, '0');
  });
});

test('local superuser replay and a safe pre-existing role require no memberships', () => {
  postgresServer('postgres', ({ bin, directory }) => {
    executeAs(bin, directory, 'postgres', roleSetup);
    const memberCount = executeAs(bin, directory, 'postgres', `
      SELECT count(*) FROM pg_catalog.pg_auth_members AS am
      JOIN pg_catalog.pg_roles AS granted ON granted.oid = am.roleid
      WHERE granted.rolname = 'cache_invalidation_worker';
    `).trim();
    assert.equal(memberCount, '0');
    assert.doesNotThrow(() => executeAs(bin, directory, 'postgres', roleSetup));
  });
});

test('pre-existing unsafe attributes or any membership fail closed', () => {
  postgresServer('supabase_admin', ({ bin, directory }) => {
    executeAs(bin, directory, 'supabase_admin', `
      CREATE ROLE postgres LOGIN CREATEROLE NOSUPERUSER NOCREATEDB NOREPLICATION NOBYPASSRLS;
      CREATE ROLE authenticator NOLOGIN;
      CREATE ROLE cache_invalidation_worker LOGIN NOINHERIT NOSUPERUSER
        NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1;
    `);
    expectRoleSetupFailure(
      bin,
      directory,
      'postgres',
      roleSetup,
      'cache_invalidation_worker has unsafe role attributes'
    );

    executeAs(bin, directory, 'supabase_admin', `
      DROP ROLE cache_invalidation_worker;
      CREATE ROLE cache_invalidation_worker NOLOGIN NOINHERIT NOSUPERUSER
        NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1;
      GRANT cache_invalidation_worker TO authenticator;
    `);
    expectRoleSetupFailure(
      bin,
      directory,
      'postgres',
      roleSetup,
      'pre-existing cache_invalidation_worker has unexpected members'
    );
  });
});

test('a later migration failure rolls back role creation and the history row', () => {
  postgresServer('supabase_admin', ({ bin, directory }) => {
    executeAs(bin, directory, 'supabase_admin', `
      CREATE ROLE postgres LOGIN CREATEROLE NOSUPERUSER NOCREATEDB NOREPLICATION NOBYPASSRLS;
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
      GRANT USAGE ON SCHEMA supabase_migrations TO postgres;
      GRANT INSERT ON supabase_migrations.schema_migrations TO postgres;
    `);
    const failingMigrationTransaction = `
      BEGIN;
      SET LOCAL lock_timeout = '30s';
      ${roleSetup}
      INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('20261028010000');
      SELECT 1 / 0;
      COMMIT;
    `;
    expectRoleSetupFailure(
      bin,
      directory,
      'postgres',
      failingMigrationTransaction,
      'division by zero'
    );

    const roleExists = executeAs(bin, directory, 'supabase_admin', `
      SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'cache_invalidation_worker');
    `).trim();
    const recorded = executeAs(bin, directory, 'supabase_admin', `
      SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20261028010000';
    `).trim();
    assert.equal(roleExists, 'f');
    assert.equal(recorded, '0');
  });
});

test('creator validation pins member and grantor predicates and the deploy transaction', () => {
  assert.match(roleSetup, /membership\.member = current_user::regrole/);
  assert.match(roleSetup, /NOT membership\.inherit_option/);
  assert.match(roleSetup, /NOT membership\.set_option/);
  assert.match(roleSetup, /grantor\.oid = membership\.grantor[\s\S]*?grantor\.rolsuper/);
  assert.match(roleSetup, /v_created[\s\S]*?v_member_count <> 0/);
  assert.match(roleSetup, /ELSIF v_member_count <> 0/);
  assert.doesNotMatch(migration, /^-- disable-transaction/m);
  assert.doesNotMatch(migration, /ALTER ROLE cache_invalidation_worker[\s\S]*?NOSUPERUSER/);
  assert.doesNotMatch(migration, /GRANT cache_invalidation_worker TO (?:PUBLIC|authenticator)/);

  const applier = readFileSync(new URL('./apply-pending-migration.sh', import.meta.url), 'utf8');
  assert.match(applier, /BEGIN;[\s\S]*?\$sql[\s\S]*?\$registration[\s\S]*?COMMIT;/);

  const workflow = readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /node --test \.github\/scripts\/cache-invalidation-worker-role-migration\.test\.mjs/);
  const ciFilter = readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8');
  assert.match(ciFilter, /- '\.github\/scripts\/cache-invalidation-worker-role-migration\.test\.mjs'/);
});
