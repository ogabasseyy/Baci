import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('signed address capabilities remain confined through the staged PostgREST rollout', { timeout: 90000 }, async () => {
  const docker = process.env.BACI_ADDRESS_BUDGET_DOCKER === '1';
  const executable = process.env.POSTGREST_BIN ?? 'postgrest';
  const dir = mkdtempSync(join(tmpdir(), 'address-budget-http-'));
  const container = 'address-budget-http-' + randomUUID();
  const pgPort = await freePort();
  const apiPort = await freePort();
  const pgBin = docker ? undefined : process.env.PG_BIN ?? execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
  const secret = 'synthetic-local-address-secret-at-least-32-characters';
  let started = false;
  let api;
  let apiLog = '';
  const sqlArgs = ['-X', '-qAt', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
  const run = sql => docker
    ? execFileSync('docker', ['exec', container, 'psql', ...sqlArgs, '-c', sql], { encoding: 'utf8' }).trim()
    : execFileSync(join(pgBin, 'psql'), [...sqlArgs, '-p', String(pgPort), '-c', sql], { encoding: 'utf8' }).trim();
  const source = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
  try {
    if (docker) {
      execFileSync('docker', ['run', '--rm', '-d', '--name', container,
        '-p', `127.0.0.1:${pgPort}:5432`, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17.11-bookworm']);
    } else {
      execFileSync(join(pgBin, 'initdb'), ['-D', join(dir, 'data'), '-A', 'trust', '--no-locale', '-U', 'postgres']);
      execFileSync(join(pgBin, 'pg_ctl'), ['-D', join(dir, 'data'), '-l', join(dir, 'postgres.log'),
        '-o', `-k ${dir} -h 127.0.0.1 -p ${pgPort}`, '-w', 'start']);
    }
    started = true;
    for (let i = 0; i < 60; i++) {
      const ready = docker
        ? spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1'], { stdio: 'ignore' }).status === 0
        : true;
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    run(source('supabase/tests/address_provider_budget.fixture.sql'));
    run("GRANT anon TO authenticator; CREATE TABLE public.orders(id integer); CREATE FUNCTION public.unrelated_address_test_rpc() RETURNS integer LANGUAGE sql AS 'SELECT 1';");
    run(source('supabase/migrations/20261030075538_address_provider_budget_gigl_guard.sql'));
    assert.equal(run("SELECT pg_has_role('authenticator','address_budget_reserver','MEMBER')"), 'f');
    api = spawn(executable, [], { env: { ...process.env,
      PGRST_DB_URI: `postgresql://authenticator@127.0.0.1:${pgPort}/postgres`,
      PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon',
      PGRST_DB_PRE_REQUEST: 'public.enforce_gigl_tracking_worker_request_scope',
      PGRST_JWT_SECRET: secret, PGRST_SERVER_HOST: '127.0.0.1', PGRST_SERVER_PORT: String(apiPort),
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    api.on('error', error => { apiLog += error.message; });
    api.stdout.on('data', data => { apiLog += data; });
    api.stderr.on('data', data => { apiLog += data; });
    const origin = `http://127.0.0.1:${apiPort}`;
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { await fetch(origin); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, apiLog.replaceAll(secret, '[redacted]'));
    const call = (path, token, method = 'POST') => fetch(`${origin}/rpc/${path}`, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    const canary = await call('__address_budget_hook_reload_canary__');
    assert.equal((await canary.json()).message, 'ADDRESS BUDGET hook reload canary observed');
    run(source('supabase/migrations/20261030075540_address_provider_budget_gigl_ledger.sql'));
    run(source('supabase/tests/address_provider_budget.sql'));
    assert.equal(run("SELECT pg_has_role('authenticator','address_budget_reserver','MEMBER')"), 't');
    const sign = (id = randomUUID(), overrides = {}) => {
      const now = Math.floor(Date.now() / 1000);
      const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url');
      const payload = encode({ role: 'address_budget_reserver', address_provider: 'google',
        address_request_kind: 'autocomplete', address_credential_hash: 'a'.repeat(64),
        address_reservation_id: id, iat: now, exp: now + 60, ...overrides });
      const unsigned = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + payload;
      return unsigned + '.' + createHmac('sha256', secret).update(unsigned).digest('base64url');
    };
    let response;
    for (let i = 0; i < 60; i++) {
      response = await call('reserve_address_provider_request', sign());
      if (response.status === 200) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'unavailable');
    run("SELECT address_budget.authorize_provider('google','synthetic-account',ARRAY[repeat('a',64)],4399,'local-only verified fixture',clock_timestamp(),clock_timestamp()+interval '30 minutes')");
    const requests = await Promise.all(Array.from({ length: 5 }, () => call('reserve_address_provider_request', sign())));
    const results = await Promise.all(requests.map(async result => { assert.equal(result.status, 200); return result.json(); }));
    assert.equal(results.filter(result => result.status === 'reserved').length, 1);
    const admitted = results.find(result => result.status === 'reserved');
    assert.equal((await (await call('reserve_address_provider_request', sign(admitted.reservationId))).json()).status, 'duplicate');
    const sibling = await call('unrelated_address_test_rpc', sign());
    assert.equal(sibling.status, 403);
    assert.equal((await sibling.json()).message, 'Address budget request is outside its capability scope');
    assert.ok(!(await call('reserve_address_provider_request')).ok);
    assert.ok(!(await call('reserve_address_provider_request', sign(), 'GET')).ok);
    assert.ok(!(await call('reserve_address_provider_request', sign(randomUUID(), { exp: 1 }))).ok);
    assert.equal(run('SELECT count(*) FROM address_budget.reservations'), '1');
  } finally {
    if (api?.pid && api.exitCode === null && api.signalCode === null) {
      const exited = new Promise(resolve => api.once('exit', resolve));
      api.kill('SIGTERM'); await exited;
    }
    if (started) {
      if (docker) execFileSync('docker', ['stop', '-t', '2', container]);
      else execFileSync(join(pgBin, 'pg_ctl'), ['-D', join(dir, 'data'), '-m', 'immediate', '-w', 'stop']);
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
