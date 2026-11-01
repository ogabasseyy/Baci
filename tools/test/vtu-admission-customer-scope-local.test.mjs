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

test('authenticated VTU admission scope', async () => {
  const directory = mkdtempSync('/tmp/baci-vtu-admission-');
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
    port: 55489,
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
      `-h '' -k '${socket}' -p 55489`,
      'start',
    ]);
    started = true;
    await client.connect();
    await client.query(readFileSync(join(repository, 'tools/test/vtu-admission-fixture.sql'), 'utf8'));
    for (const migration of [
      '20261020071000_vtu_admission_proof.sql',
      '20261020090105_harden_claim_vtu_intent.sql',
    ]) await client.query(readFileSync(join(repository, 'supabase/migrations', migration), 'utf8'));
    const resolver = readFileSync(join(repository, 'supabase/migrations/20261020090101_vtu_checkout_customer_rpcs.sql'), 'utf8');
    const start = resolver.indexOf('CREATE OR REPLACE FUNCTION public._vtu_checkout_caller_customer(');
    await client.query(resolver.slice(start, resolver.indexOf('$$;', start) + 3));
    if (!process.argv.includes('--baseline')) await client.query(readFileSync(join(repository,
      'supabase/migrations/20261101093558_scope_vtu_admission_to_authenticated_customer.sql'), 'utf8'));
    await client.query(readFileSync(join(repository, 'supabase/tests/vtu_admission_customer_scope.sql'), 'utf8'));
  } finally {
    await client.end();
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', 'stop']);
    rmSync(directory, { recursive: true });
  }
});
