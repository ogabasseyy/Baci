import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { officialManagedPgStatStatementsRepair } from './official-managed-prerequisites-pg-stat-statements-repair.mjs';
import { officialManagedPrerequisites } from './official-managed-prerequisites.mjs';

const read = (name) =>
  readFileSync(
    new URL(`./official-managed-prerequisites-${name}`, import.meta.url),
    'utf8'
  );
const manifest = JSON.parse(read('sources.json'));

test('official PG170006 local disposable replay and rejection matrix', {
  skip: process.env.BACI_MANAGED_PREREQUISITES_TEST !== '1',
}, async (context) => {
  const name = `baci-managed-prerequisites-test-${process.pid}`;
  const image = `supabase/postgres@${manifest.postgresImageDigest}`;
  const socket =
    process.env.BACI_MANAGED_PREREQUISITES_DOCKER_SOCKET ??
    '/var/run/docker.sock';
  assert.match(socket, /^\/[A-Za-z0-9_./-]+$/);
  const docker = (args, input) =>
    spawnSync('docker', ['--host', `unix://${socket}`, ...args], {
      encoding: 'utf8',
      input,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
  assert.equal(
    docker(['image', 'inspect', image, '--format', '{{.Id}}']).status,
    0,
    'Pinned image must be pre-pulled; tests never pull'
  );
  const start = docker([
    'run',
    '-d',
    '--pull',
    'never',
    '--network',
    'none',
    '--name',
    name,
    '--user',
    'postgres',
    '--tmpfs',
    '/tmp:rw,mode=1777',
    '--entrypoint',
    '/bin/sh',
    image,
    '-c',
      'initdb -D /tmp/managed-pg -A trust --no-locale >/tmp/init.log && exec postgres -D /tmp/managed-pg -k /tmp -c listen_addresses= -c shared_preload_libraries=pg_cron,pg_net,pg_stat_statements -c pg_stat_statements.track=none -c pg_stat_statements.track_utility=off -c cron.launch_active_jobs=off -c pg_net.database_name=baci_disabled_background -c wal_level=logical -c log_min_messages=panic',
  ]);
  assert.equal(start.status, 0, start.stderr);
  const query = (sql) =>
    docker(
      [
        'exec',
        '-i',
        name,
        'psql',
        '-X',
        '-q',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
        '-h',
        '/tmp',
        '-U',
        'postgres',
        '-d',
        'postgres',
      ],
      sql
    );
  try {
    assert.equal(
      docker([
        'exec',
        name,
        '/bin/sh',
        '-c',
        'until pg_isready -h /tmp -U postgres >/dev/null 2>&1; do sleep 0.1; done',
      ]).status,
      0
    );
    const fixture = query(
      read('fixture-auth.sql') + read('fixture-triggers.sql')
    );
    assert.equal(fixture.status, 0, fixture.stderr);
    const systemIdentifier = query(
      'SELECT system_identifier FROM pg_control_system();'
    ).stdout.trim();
    const { sql } = officialManagedPrerequisites({
      systemIdentifier,
      schemaOnlyReviewed: true,
    });
    const denied = (body, expected) => {
      const result = query(body);
      assert.equal(result.status, 3);
      assert.match(result.stderr, expected);
      assert.equal(
        query(
          "SELECT count(*) FROM pg_extension WHERE extname='pg_net';"
        ).stdout.trim(),
        '0'
      );
      assert.equal(
        query(
          "SELECT count(*) FROM pg_event_trigger WHERE evtenabled='O';"
        ).stdout.trim(),
        '2'
      );
    };
    await context.test(
      'rejects different identity and session-only containment without writes',
      () => {
        denied(
          sql.replace(systemIdentifier, '1111111111111111111'),
          /cluster identity mismatch/
        );
        denied(
          sql.replace(
            'BEGIN;',
            "BEGIN; SET LOCAL cron.launch_active_jobs='off';"
          ),
          /parameter "cron.launch_active_jobs" cannot be changed now/
        );
      }
    );
    await context.test('rejects a real background target database', () => {
      assert.equal(
        query('CREATE DATABASE baci_disabled_background;').status,
        0
      );
      denied(sql, /startup background containment/);
      assert.equal(
        query('DROP DATABASE baci_disabled_background WITH (FORCE);').status,
        0
      );
    });
    await context.test(
      'rejects modified official event trigger function and rolls it back',
      () => {
        denied(
          sql.replace(
            'BEGIN;',
            () =>
              'BEGIN; CREATE OR REPLACE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;'
          ),
          /net trigger source mismatch/
        );
      }
    );
    await context.test(
      'rejects any unrelated event trigger before extension installation',
      () => {
        denied(
          sql.replace(
            'BEGIN;',
            "BEGIN; CREATE EVENT TRIGGER unknown_access ON ddl_command_end WHEN TAG IN ('CREATE SCHEMA') EXECUTE FUNCTION extensions.grant_pg_cron_access();"
          ),
          /event triggers require separate review/
        );
      }
    );
    await context.test(
      'late verification failure rolls back extensions and trigger disables',
      () => {
        denied(
          sql.replace(
            'DO $verify$',
            () =>
              "DO $$ BEGIN RAISE EXCEPTION 'synthetic late rejection'; END $$; DO $verify$"
          ),
          /ERROR: {2}synthetic late rejection/
        );
      }
    );
    await context.test(
      'commits official schema-only prerequisites preserving existing Auth and Storage',
      () => {
        assert.equal(
          query(
            'CREATE SCHEMA storage; CREATE TABLE storage.preservation_fixture (id integer PRIMARY KEY); INSERT INTO storage.preservation_fixture VALUES (7); ALTER TABLE storage.preservation_fixture ENABLE ROW LEVEL SECURITY;'
          ).status,
          0
        );
        const result = query(sql);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /schema-only verified/);
        assert.equal(
          query('SELECT id FROM storage.preservation_fixture;').stdout.trim(),
          '7'
        );
        assert.equal(
          query(
            "SELECT count(*) FROM auth.users WHERE email='synthetic@example.invalid';"
          ).stdout.trim(),
          '1'
        );
        assert.equal(
          query(
            "SELECT count(*) FROM pg_event_trigger WHERE evtenabled<>'D';"
          ).stdout.trim(),
          '0'
        );
        assert.equal(
          query(
            "SELECT count(*) FROM pg_extension WHERE extname IN ('uuid-ossp','pgcrypto','pg_trgm','vector','pg_net','pg_cron','supabase_vault');"
          ).stdout.trim(),
          '7'
        );
      }
    );
    await context.test('baseline query-performance view requires installed pg_stat_statements, not just preloading', () => {
      const baseline = readFileSync(new URL('../../../supabase/migrations/20260418000000_baseline.sql', import.meta.url), 'utf8');
      const view = baseline.match(/CREATE OR REPLACE VIEW "public"\."admin_query_performance"[\s\S]*?LIMIT 50;/)?.[0];
      assert.ok(view);
      const missing = query(`BEGIN; DROP EXTENSION IF EXISTS pg_stat_statements; ${view}`);
      assert.equal(missing.status, 3);
      assert.match(missing.stderr, /relation "extensions.pg_stat_statements" does not exist/);
      const installed = query(`BEGIN; ${view} SELECT count(*) FROM public.admin_query_performance; ROLLBACK;`);
      assert.equal(installed.status, 0, installed.stderr);
      assert.equal(query('DROP EXTENSION pg_stat_statements; CREATE SCHEMA hosted_savings_install_private;').status, 0);
      const repair = officialManagedPgStatStatementsRepair(query('SELECT system_identifier FROM pg_control_system();').stdout.trim());
      const sessionOverride = query("SET pg_stat_statements.track = 'none';\n" + repair);
      assert.equal(sessionOverride.status, 3);
      assert.match(sessionOverride.stderr, /Persistent pg_stat_statements tracking disablement required/);
      const repaired = query(repair);
      assert.equal(repaired.status, 0, repaired.stderr);
      assert.equal(query(`BEGIN; ${view} SELECT count(*) FROM public.admin_query_performance; ROLLBACK;`).status, 0);
      assert.equal(query('DROP SCHEMA hosted_savings_install_private;').status, 0);
    });
    await context.test(
      'RLS is default deny and unsupported operations fail explicitly',
      () => {
        assert.equal(
          query(
            'SET ROLE anon; SELECT count(*) FROM realtime.messages;'
          ).stdout.trim(),
          '0'
        );
        assert.equal(
          query(
            "SET ROLE anon; INSERT INTO realtime.messages(topic,extension) VALUES ('test','broadcast');"
          ).status,
          3
        );
        assert.match(
          query("SELECT realtime.send('{}'::jsonb,'test','topic',true);")
            .stderr,
          /does not exist/
        );
        assert.match(
          query("SELECT graphql_public.graphql(query := '{ __typename }');")
            .stdout,
          /pg_graphql extension is not enabled/
        );
        assert.equal(
          query(
            'SELECT count(*) FROM vault.secrets; SELECT count(*) FROM cron.job; SELECT count(*) FROM net.http_request_queue;'
          ).stdout.trim(),
          '0\n0\n0'
        );
      }
    );
    await context.test(
      'repeat apply refuses adoption without undoing completed prerequisites',
      () => {
        const result = query(sql);
        assert.equal(result.status, 3);
        assert.match(result.stderr, /Existing managed objects/);
        assert.equal(
          query('SELECT count(*) FROM vault.secrets;').stdout.trim(),
          '0'
        );
      }
    );
  } finally {
    assert.equal(
      docker(['rm', '-f', '-v', name]).status,
      0,
      'Disposable test container cleanup failed'
    );
  }
});
