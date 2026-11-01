import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { Client } from 'pg';

const repository = resolve(import.meta.dirname, '../..');
const bin =
  process.argv
    .find((arg) => arg.startsWith('--postgres-bin='))
    ?.slice('--postgres-bin='.length) ?? '/opt/homebrew/opt/postgresql@17/bin';

test('anonymous offer merchant scope', async () => {
  const directory = mkdtempSync('/tmp/baci-offer-scope-');
  const socket = join(directory, 'socket');
  const data = join(directory, 'data');
  mkdirSync(socket, { mode: 0o700 });
  function run(command, args) {
    const r = spawnSync(join(bin, command), args, {
      encoding: 'utf8',
      timeout: 30000,
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
    });
    assert.equal(r.status, 0, r.stderr);
  }
  const client = new Client({
    host: socket,
    port: 55487,
    user: 'postgres',
    database: 'postgres',
  });
  let started = false;
  try {
    run('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale']);
    run('pg_ctl', [
      '-D',
      data,
      '-l',
      join(directory, 'log'),
      '-o',
      `-h '' -k '${socket}' -p 55487`,
      'start',
    ]);
    started = true;
    await client.connect();
    await client.query(
      `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;`
    );
    const source = readFileSync(
      join(
        repository,
        'supabase/migrations/20261020120000_storefront_offer_resolution_authority.sql'
      ),
      'utf8'
    );
    const start = source.indexOf(
      'CREATE OR REPLACE FUNCTION public.get_storefront_offer_resolution('
    );
    const end = source.indexOf('AS $$', start);
    await client.query(
      source.slice(start, source.indexOf('  RETURN QUERY', end)) +
        '  RETURN;\nEND;\n$$;'
    );
    if (!process.argv.includes('--baseline'))
      await client.query(
        readFileSync(
          join(
            repository,
            'supabase/migrations/20261101083018_scope_anonymous_offer_authority.sql'
          ),
          'utf8'
        )
      );
    await client.query(
      readFileSync(
        join(repository, 'supabase/tests/anonymous_offer_merchant_scope.sql'),
        'utf8'
      )
    );
  } finally {
    await client.end();
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', 'stop']);
    rmSync(directory, { recursive: true });
  }
});
