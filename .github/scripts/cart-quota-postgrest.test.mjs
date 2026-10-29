import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const postgrest = spawnSync('which', ['postgrest'], { encoding: 'utf8' }).stdout.trim();
const scope = new URL('../../supabase/migrations/20261027051250_commerce_cart_quota_gigl_guard.sql', import.meta.url);
const grant = new URL('../../supabase/migrations/20261027051251_commerce_cart_supabase_quota_gigl_request_scope.sql', import.meta.url);

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('real PostgREST confines a signed quota token and serializes increments', { skip: !postgrest, timeout: 30000 }, async () => {
  const bin = process.env.PG_BIN ?? execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
  const dir = mkdtempSync(join(tmpdir(), 'baci-quota-api-'));
  const pgPort = await freePort();
  const apiPort = await freePort();
  const proxyPort = await freePort();
  const secret = 'synthetic-local-quota-signing-secret-1234567890';
  const run = (name, args, input) => execFileSync(join(bin, name), args, {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  const connection = ['-h', '127.0.0.1', '-p', String(pgPort), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
  let pgStarted = false;
  let api;
  let proxy;
  try {
    run('initdb', ['-D', join(dir, 'data'), '-A', 'trust', '--no-locale', '-U', 'postgres']);
    // A package's default socket directory may not be writable by the CI user.
    // Make that condition deterministic; this TCP-only test must not use it.
    appendFileSync(join(dir, 'data', 'postgresql.conf'), "\nunix_socket_directories = '/dev/null'\n");
    try {
      run('pg_ctl', ['-D', join(dir, 'data'), '-l', join(dir, 'postgres.log'), '-o', `-k '' -h 127.0.0.1 -p ${pgPort}`, '-w', 'start']);
    } catch (error) {
      const logPath = join(dir, 'postgres.log');
      const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : 'No startup log was written.';
      throw new Error(`Disposable PostgreSQL failed to start:\n${log}`, { cause: error });
    }
    pgStarted = true;
    run('psql', connection, `
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE ROLE authenticator LOGIN NOINHERIT;
      GRANT anon TO authenticator;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
        $$ SELECT current_setting('request.jwt.claims', true)::jsonb->>'role' $$;
      CREATE FUNCTION public.__gigl_hook_reload_canary__() RETURNS text
        LANGUAGE sql IMMUTABLE AS $$ SELECT 'unrestricted' $$;
      REVOKE ALL ON FUNCTION public.__gigl_hook_reload_canary__()
        FROM PUBLIC, anon, authenticated;
      GRANT EXECUTE ON FUNCTION public.__gigl_hook_reload_canary__() TO anon;
      CREATE FUNCTION public.enforce_gigl_tracking_worker_request_scope()
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
      DECLARE
        request_method text := current_setting('request.method', true);
        request_path text := current_setting('request.path', true);
        request_role text := auth.role();
      BEGIN
        IF request_role = 'gigl_tracking_worker' THEN
          IF request_path IS DISTINCT FROM '/rpc/gigl_worker_claim_due_tracking_monitors' THEN
            RAISE EXCEPTION 'GIGL worker request is outside its capability scope' USING ERRCODE='42501';
          END IF;
        END IF;
      END $$;
      ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.enforce_gigl_tracking_worker_request_scope';
    `);
    run('psql', connection, readFileSync(scope, 'utf8'));
    run('psql', connection, readFileSync(grant, 'utf8'));
    api = spawn(postgrest, [], {
      env: {
        ...process.env,
        PGRST_DB_URI: `postgresql://authenticator@127.0.0.1:${pgPort}/postgres`,
        PGRST_DB_SCHEMAS: 'public',
        PGRST_DB_ANON_ROLE: 'anon',
        PGRST_DB_PRE_REQUEST: 'public.enforce_gigl_tracking_worker_request_scope',
        PGRST_JWT_SECRET: secret,
        PGRST_SERVER_HOST: '127.0.0.1',
        PGRST_SERVER_PORT: String(apiPort),
      },
      stdio: 'ignore',
    });
    const origin = `http://127.0.0.1:${apiPort}`;
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { await fetch(origin); ready = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, 'local PostgREST started');
    const now = Math.floor(Date.now() / 1000);
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({ alg: 'HS256', typ: 'JWT' });
    const body = encode({
      role: 'commerce_cart_quota',
      cart_quota_key: createHash('sha256').update('synthetic-key').digest('hex'),
      cart_quota_window_ms: 60000,
      iat: now,
      exp: now + 60,
    });
    const unsigned = `${header}.${body}`;
    const jwt = `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
    const call = (path, token = jwt) => fetch(`${origin}/rpc/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const first = await call('increment_commerce_cart_quota');
    assert.equal(first.status, 200);
    const firstData = await first.json();
    assert.equal(firstData.count, 1);
    const concurrent = await Promise.all(Array.from({ length: 20 }, () => call('increment_commerce_cart_quota')));
    const counters = await Promise.all(concurrent.map((response) => {
      assert.equal(response.status, 200);
      return response.json();
    }));
    assert.deepEqual(counters.map((x) => x.count).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 2));
    assert.ok(counters.every((x) => x.resetTime === firstData.resetTime));
    const sibling = await call('__gigl_hook_reload_canary__');
    assert.equal(sibling.status, 403);
    assert.match((await sibling.json()).message, /Cart quota request is outside its capability scope/);
    const anonymous = await fetch(`${origin}/rpc/increment_commerce_cart_quota`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.ok(!anonymous.ok);
    proxy = spawn(process.execPath, ['-e', `
      const http = require('node:http');
      http.createServer((req, res) => {
        const path = req.url.startsWith('/rest/v1') ? req.url.slice(8) : req.url;
        const next = http.request({ hostname: '127.0.0.1', port: ${apiPort}, path, method: req.method, headers: req.headers }, (upstream) => {
          res.writeHead(upstream.statusCode, upstream.headers);
          upstream.pipe(res);
        });
        req.pipe(next);
      }).listen(${proxyPort}, '127.0.0.1');
    `], { stdio: 'ignore' });
    const proxyOrigin = `http://127.0.0.1:${proxyPort}`;
    let proxyReady = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { await fetch(proxyOrigin); proxyReady = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    assert.ok(proxyReady, 'local REST proxy started');
    // The operator probe must not depend on a pnpm launcher that can stall in CI.
    const fakeBin = join(dir, 'fake-bin');
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, 'pnpm'), '#!/bin/sh\nexec sleep 60\n', { mode: 0o700 });
    const webRoot = fileURLToPath(new URL('../../apps/web/', import.meta.url));
    const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
    const operator = spawnSync(process.execPath, [
      webRequire.resolve('tsx/cli'), 'src/scripts/probe-cart-quota.ts', '--execute',
    ], {
      cwd: webRoot,
      env: {
        PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
        NODE_OPTIONS: '--conditions=react-server',
        NODE_ENV: 'development',
        NEXT_PUBLIC_SUPABASE_URL: proxyOrigin,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon-key',
        SUPABASE_JWT_SECRET: secret,
        SUPABASE_SERVICE_ROLE_KEY: 'unused-test-placeholder',
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    const operatorFailure = operator.error?.code ?? operator.signal ?? `exit ${operator.status}`;
    assert.equal(operator.status, 0, `operator probe failed (${operatorFailure}): ${(operator.stderr ?? '').replaceAll(secret, '[redacted]')}`);
    assert.match(operator.stdout, /counter and scope probe passed/);
    assert.ok(!operator.stdout.includes(secret));
    assert.ok(!operator.stderr.includes(secret));
  } finally {
    if (proxy && proxy.exitCode === null && proxy.signalCode === null) {
      const exited = new Promise((resolve) => proxy.once('exit', resolve));
      proxy.kill('SIGTERM');
      await exited;
    }
    if (api && api.exitCode === null && api.signalCode === null) {
      const exited = new Promise((resolve) => api.once('exit', resolve));
      api.kill('SIGTERM');
      await exited;
    }
    if (pgStarted) run('pg_ctl', ['-D', join(dir, 'data'), '-m', 'fast', '-w', 'stop']);
    rmSync(dir, { recursive: true, force: true });
  }
});
