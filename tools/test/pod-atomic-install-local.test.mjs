import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const pg =
  process.argv
    .find((arg) => arg.startsWith('--postgres-bin='))
    ?.slice('--postgres-bin='.length) ||
  spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' }).stdout.trim();
const migration = join(
  root,
  'supabase/migrations/20261102120000_atomic_pod_policy.sql'
);

test('POD installation is atomic, scoped, and safely re-runnable', async () => {
  const sql = readFileSync(migration, 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'baci-pod-atomic-'));
  const socket = join(dir, 's');
  mkdirSync(socket);
  const run = (name, args, input) => {
    const result = spawnSync(join(pg, name), args, {
      encoding: 'utf8',
      input,
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  let started = false;
  let installer;
  let lockHolder;
  try {
    run('initdb', [
      '-D',
      join(dir, 'db'),
      '-A',
      'trust',
      '-U',
      'postgres',
      '--no-locale',
      '-E',
      'UTF8',
    ]);
    run('pg_ctl', [
      '-D',
      join(dir, 'db'),
      '-l',
      join(dir, 'log'),
      '-o',
      `-h '' -k '${socket}' -p 55482`,
      'start',
    ]);
    started = true;
    const args = [
      '-X',
      '-w',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      socket,
      '-p',
      '55482',
      '-U',
      'postgres',
      '-d',
      'postgres',
    ];
    run(
      'psql',
      args,
      `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA private; CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
CREATE TABLE public.merchant_feature_settings (merchant_id uuid PRIMARY KEY, pay_on_delivery_enabled boolean);
CREATE TABLE public.orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid, payment_method text, checkout_idempotency_key text, checkout_request_hash text);`
    );
    const broken = sql.replace(
      "TO authenticated';",
      "TO pod_role_that_does_not_exist';"
    );
    assert.notEqual(
      broken,
      sql,
      'failure injection must alter the final grant'
    );
    const failed = spawnSync(join(pg, 'psql'), args, {
      encoding: 'utf8',
      input: broken,
      timeout: 30000,
    });
    assert.notEqual(
      failed.status,
      0,
      'injected failure must abort installation'
    );
    const rolledBack = run(
      'psql',
      [...args, '-At'],
      `SELECT to_regprocedure('public.is_storefront_pod_order_idempotency_hash(uuid,text,text)') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='orders_enforce_pay_on_delivery_policy');`
    );
    assert.equal(
      rolledBack.trim(),
      't',
      'failed installation must leave neither trigger nor probe'
    );
    // Pause after CREATE FUNCTION and before REVOKE inside the same statement.
    // Another session must not see the newly created function or trigger.
    const marker =
      "  EXECUTE 'REVOKE ALL ON FUNCTION public.is_storefront_pod_order_idempotency_hash";
    const paused = sql.replace(
      marker,
      `  PERFORM pg_advisory_xact_lock(367012);\n${marker}`
    );
    assert.notEqual(
      paused,
      sql,
      'visibility test must pause before the revoke'
    );
    lockHolder = spawn(join(pg, 'psql'), [...args, '-At'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = createInterface({ input: lockHolder.stdout });
    const ready = new Promise((resolve, reject) => {
      lines.on('line', (line) => {
        if (line === 'ready') resolve();
      });
      lockHolder.once('error', reject);
      lockHolder.once('close', (code) =>
        reject(new Error(`lock holder exited early: ${code}`))
      );
    });
    lockHolder.stdin.write(
      "SELECT pg_advisory_lock(367012); SELECT 'ready';\n"
    );
    await ready;
    installer = spawn(join(pg, 'psql'), args, {
      env: { ...process.env, PGAPPNAME: 'pod_atomic_visibility' },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    installer.stderr.setEncoding('utf8');
    installer.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const completion = new Promise((resolve, reject) => {
      installer.once('error', reject);
      installer.once('close', (code) => resolve(code));
    });
    installer.stdin.end(paused);
    let sleeping = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const observed = run(
        'psql',
        [...args, '-At'],
        "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='pod_atomic_visibility' AND wait_event_type='Lock');"
      );
      if (observed.trim().startsWith('t')) {
        sleeping = true;
        break;
      }
    }
    assert.ok(sleeping, 'installer must wait at the pre-grant visibility lock');
    const invisible = run(
      'psql',
      [...args, '-At'],
      `SELECT to_regprocedure('public.is_storefront_pod_order_idempotency_hash(uuid,text,text)') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='orders_enforce_pay_on_delivery_policy');`
    );
    assert.equal(
      invisible.trim(),
      't',
      'another session must not see partial installation'
    );
    lockHolder.stdin.end('SELECT pg_advisory_unlock(367012);\n');
    assert.equal(await completion, 0, stderr);
    installer = undefined;
    run('psql', args, sql);
    const checks = readFileSync(
      join(root, 'tools/test/pod-atomic-install-checks.sql'),
      'utf8'
    );
    writeFileSync(join(dir, 'checks.sql'), checks);
    run('psql', [...args, '-f', join(dir, 'checks.sql')]);
  } finally {
    installer?.kill();
    lockHolder?.kill();
    if (started) run('pg_ctl', ['-D', join(dir, 'db'), '-m', 'fast', 'stop']);
    rmSync(dir, { recursive: true, force: true });
  }
});
