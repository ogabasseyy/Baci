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

test('loyalty checkout replay remains bound to its original redemption', async () => {
  const directory = mkdtempSync('/tmp/baci-loyalty-replay-');
  const socket = join(directory, 'socket');
  const data = join(directory, 'data');
  mkdirSync(socket, { mode: 0o700 });
  function run(command, args) {
    const result = spawnSync(join(bin, command), args, {
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr);
  }
  const client = new Client({
    host: socket,
    port: 55484,
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
      join(directory, 'postgres.log'),
      '-o',
      `-h '' -k '${socket}' -p 55484`,
      'start',
    ]);
    started = true;
    await client.connect();
    await client.query(
      'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;'
    );
    for (const name of [
      '20261009235959_loyalty_reward_classification.sql',
      '20261010000021_loyalty_checkout_order_wrapper.sql',
    ]) {
      await client.query(
        readFileSync(join(repository, 'supabase/migrations', name), 'utf8')
      );
    }
    if (!process.argv.includes('--baseline')) {
      await client.query(
        readFileSync(
          join(
            repository,
            'supabase/migrations/20261101073101_bind_loyalty_checkout_replay_redemption.sql'
          ),
          'utf8'
        )
      );
    }
    await client.query(
      readFileSync(
        join(repository, 'supabase/tests/loyalty_checkout_replay_binding.sql'),
        'utf8'
      )
    );
  } finally {
    await client.end();
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', 'stop']);
    rmSync(directory, { recursive: true });
  }
});
