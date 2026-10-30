import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { after, before, beforeEach, test } from 'node:test';

const exec = promisify(execFile);
const docker = process.env.BACI_ADDRESS_BUDGET_DOCKER === '1';
const directory = mkdtempSync(join(tmpdir(), 'baci-address-budget-'));
const container = 'baci-address-budget-' + randomUUID();
const fingerprint = 'a'.repeat(64);
let pgBin;
let started = false;

function invocation(sql) {
  const args = ['-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql];
  return docker
    ? ['docker', ['exec', container, 'psql', '-h', '127.0.0.1', ...args]]
    : [join(pgBin, 'psql'), ['-h', directory, '-p', '55486', ...args]];
}
function query(sql) {
  const [command, args] = invocation(sql);
  return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim();
}
async function concurrentQuery(sql) {
  const [command, args] = invocation(sql);
  return (await exec(command, args, { maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
}
function claims(provider = 'google', kind = 'autocomplete', id = randomUUID(), key = fingerprint) {
  return { role: 'address_budget_reserver', address_provider: provider, address_request_kind: kind,
    address_credential_hash: key, address_reservation_id: id };
}
function requestSql(payload) {
  const issuedAt = Math.floor(Date.now()/1000);
  return `BEGIN;
    SET LOCAL request.jwt.claims = '${JSON.stringify({ iat: issuedAt, exp: issuedAt+60, ...payload })}';
    SET LOCAL ROLE address_budget_reserver;
    SELECT public.reserve_address_provider_request();
    COMMIT;`;
}
function reserve(payload = claims()) { return JSON.parse(query(requestSql(payload))); }
function authorize(provider = 'google', baseline = 0, keys = [fingerprint]) {
  query(`SELECT address_budget.authorize_provider(
    '${provider}', 'synthetic-account', ARRAY[${keys.map(k=>`'${k}'`).join(',')}],
    ${baseline}, 'synthetic-verified-evidence', clock_timestamp(),
    clock_timestamp() + interval '30 minutes');`);
}

before(async () => {
  if (docker) {
    execFileSync('docker', ['run', '--rm', '-d', '--network', 'none', '--name', container,
      '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17.11-bookworm'], { stdio: 'pipe' });
  } else {
    pgBin = process.env.PG_BIN ?? execFileSync('pg_config', ['--bindir'], { encoding:'utf8' }).trim();
    execFileSync(join(pgBin, 'initdb'), ['-D', join(directory, 'data'), '-A', 'trust', '--no-locale', '-U', 'postgres']);
    execFileSync(join(pgBin, 'pg_ctl'), ['-D', join(directory, 'data'), '-l', join(directory, 'postgres.log'),
      '-o', `-k ${directory} -h '' -p 55486`, '-w', 'start']);
  }
  started = true;
  for (let attempt = 0; attempt < 60; attempt++) {
    const [command, args] = invocation('SELECT 1');
    if (spawnSync(command, args, { stdio: 'ignore' }).status === 0) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  query(readFileSync(new URL('../../supabase/tests/address_provider_budget.fixture.sql', import.meta.url), 'utf8'));
  for (const file of ['20261030075538_address_provider_budget_gigl_guard.sql',
    '20261030075540_address_provider_budget_gigl_ledger.sql']) {
    query(readFileSync(new URL('../../supabase/migrations/' + file, import.meta.url), 'utf8'));
  }
});
after(() => {
  if (started) {
    if (docker) execFileSync('docker', ['stop', '-t', '2', container], { stdio: 'pipe' });
    else execFileSync(join(pgBin, 'pg_ctl'), ['-D', join(directory, 'data'), '-m', 'immediate', '-w', 'stop']);
  }
  rmSync(directory, { recursive: true, force: true });
});
beforeEach(() => query('TRUNCATE address_budget.reservations, address_budget.authorizations'));

test('unknown allowance is unavailable, including the start of a new period', () => {
  assert.equal(reserve().status, 'unavailable');
  assert.equal(query('SELECT count(*) FROM address_budget.reservations'), '0');
});

test('imported usage is retained and parallel autocomplete attempts share the remaining unit', async () => {
  authorize('google', 4399);
  const replies = await Promise.all(Array.from({ length: 8 }, () => concurrentQuery(requestSql(claims()))));
  assert.equal(replies.map(JSON.parse).filter(r => r.status === 'reserved').length, 1);
  assert.equal(reserve().status, 'limit_reached');
  assert.equal(reserve(claims('google', 'details')).status, 'reserved');
});

test('Details stops at the combined ceiling', () => {
  authorize('google', 4499);
  assert.equal(reserve(claims('google', 'details')).status, 'reserved');
  assert.equal(reserve(claims('google', 'details')).status, 'limit_reached');
});

test('concurrent reuse of one reservation authorizes only one upstream dispatch', async () => {
  authorize();
  const payload = claims();
  const replies = (await Promise.all(Array.from({ length: 6 }, () => concurrentQuery(requestSql(payload))))).map(JSON.parse);
  assert.equal(replies.filter(r => r.status === 'reserved').length, 1);
  assert.equal(replies.filter(r => r.status === 'duplicate').length, 5);
  assert.equal(query('SELECT count(*) FROM address_budget.reservations'), '1');
});

test('a reservation UUID cannot be replayed through another provider', () => {
  authorize('google');
  authorize('geoapify');
  const id = randomUUID();
  assert.equal(reserve(claims('google', 'autocomplete', id)).status, 'reserved');
  assert.equal(reserve(claims('geoapify', 'autocomplete', id)).status, 'duplicate');
  assert.equal(query('SELECT count(*) FROM address_budget.reservations'), '1');
});

test('a previous Google billing period never authorizes this month', () => {
  authorize();
  query("UPDATE address_budget.authorizations SET period_key = '2000-01'");
  assert.equal(reserve().status, 'unavailable');
  assert.equal(query('SELECT count(*) FROM address_budget.reservations'), '0');
});

test('Geoapify renewal may replace only expired imported debt, retaining recent reservations', () => {
  authorize('geoapify', 2799);
  assert.equal(reserve(claims('geoapify')).status, 'reserved');
  assert.throws(() => authorize('geoapify', 0), /baseline cannot decrease/);
  query("UPDATE address_budget.authorizations SET baseline_expires_at=clock_timestamp()-interval '1 second'");
  authorize('geoapify', 2798);
  query("UPDATE address_budget.reservations SET reserved_at=clock_timestamp()-interval '1 second'");
  assert.equal(reserve(claims('geoapify')).status, 'reserved');
  assert.equal(reserve(claims('geoapify')).status, 'limit_reached');
  assert.equal(query('SELECT count(*) FROM address_budget.reservations'), '2');
});

test('Geoapify keeps cutover debt for a full day after verification and drops only aged attempts', () => {
  authorize('geoapify', 2799);
  assert.equal(query("SELECT baseline_expires_at >= verified_at + interval '24 hours' FROM address_budget.authorizations"), 't');
  assert.equal(reserve(claims('geoapify')).status, 'reserved');
  query("UPDATE address_budget.reservations SET reserved_at=clock_timestamp()-interval '25 hours'");
  assert.equal(reserve(claims('geoapify')).status, 'reserved');
  assert.equal(reserve(claims('geoapify')).status, 'limit_reached');
});

test('accepted key rotation and authorization renewal do not reset the shared balance', () => {
  const other = 'b'.repeat(64);
  authorize('google', 4398);
  assert.equal(reserve().status, 'reserved');
  authorize('google', 4398, [fingerprint, other]);
  assert.equal(reserve(claims('google', 'autocomplete', randomUUID(), other)).status, 'reserved');
  assert.equal(reserve().status, 'limit_reached');
  assert.throws(() => authorize('google', 0), /baseline cannot decrease/);
});

test('unknown credential and expired authorization never create a reservation', () => {
  authorize();
  assert.equal(reserve(claims('google', 'autocomplete', randomUUID(), 'b'.repeat(64))).status, 'unavailable');
  query("UPDATE address_budget.authorizations SET valid_until = clock_timestamp() - interval '1 second'");
  assert.equal(reserve().status, 'unavailable');
  assert.equal(query('SELECT count(*) FROM address_budget.reservations'), '0');
});

test('malformed and expired capabilities never consume or authorize an attempt', () => {
  authorize();
  for (const overrides of [{ address_provider: 'unknown' }, { address_request_kind: 'reviews' },
    { address_reservation_id: 'invalid' }, { address_credential_hash: 'invalid' }]) {
    assert.throws(() => reserve({ ...claims(), ...overrides }), /Invalid address reservation capability/);
  }
  const issuedAt = Math.floor(Date.now()/1000)-61;
  assert.equal(reserve({ ...claims(), iat: issuedAt, exp: issuedAt+60 }).status, 'unavailable');
  assert.equal(query('SELECT count(*) FROM address_budget.reservations'), '0');
});

test('a reservation waiting on an owner update observes the revoked allowance', async () => {
  authorize();
  const owner = concurrentQuery(`BEGIN;
    SELECT pg_advisory_xact_lock(hashtextextended('address-budget:google',0));
    UPDATE address_budget.authorizations SET valid_until=clock_timestamp()-interval '1 second';
    SELECT pg_sleep(0.8); COMMIT;`);
  try {
    let holding = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      holding = query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='PgSleep' AND query LIKE 'BEGIN;%address-budget:google%')") === 't';
      if (holding) break;
    }
    assert.ok(holding, 'owner holds the shared provider lock');
    assert.equal(reserve().status, 'unavailable');
  } finally { await owner; }
  assert.equal(query('SELECT count(*) FROM address_budget.reservations'), '0');
});

test('Geoapify retains imported rolling debt and paces globally across accepted keys', () => {
  authorize('geoapify', 2799, [fingerprint, 'b'.repeat(64)]);
  assert.equal(reserve(claims('geoapify')).status, 'reserved');
  assert.equal(reserve(claims('geoapify', 'autocomplete', randomUUID(), 'b'.repeat(64))).status, 'limit_reached');
  query("TRUNCATE address_budget.reservations, address_budget.authorizations");
  authorize('geoapify');
  const results = query(requestSql(claims('geoapify')) + requestSql(claims('geoapify'))).split('\n').map(JSON.parse);
  assert.equal(results[0].status, 'reserved');
  const paced = results[1];
  assert.equal(paced.status, 'paced');
  assert.ok(paced.retryAfterMs > 0 && paced.retryAfterMs <= 250);
  assert.equal(query('SELECT count(*) FROM address_budget.reservations'), '1');
});

test('scoped callers cannot configure allowance or read unrelated data', () => {
  assert.equal(query("SELECT has_function_privilege('anon','public.reserve_address_provider_request()','EXECUTE')"), 'f');
  assert.throws(() => query("SET ROLE address_budget_reserver; INSERT INTO address_budget.authorizations(provider,period_key) VALUES ('google','2026-10')"), /permission denied/);
  assert.throws(() => query("SET request.jwt.claims = '{\"role\":\"address_budget_reserver\"}'; SET request.method='POST'; SET request.path='/rpc/unrelated'; SELECT public.enforce_gigl_tracking_worker_request_scope()"), /outside its capability scope/);
});

test('the pre-existing cart guard still permits its RPC and denies unrelated paths', () => {
  query("SET request.jwt.claims = '{\"role\":\"commerce_cart_quota\"}'; SET request.method='POST'; SET request.path='/rpc/increment_commerce_cart_quota'; SELECT public.enforce_gigl_tracking_worker_request_scope()");
  assert.throws(() => query("SET request.jwt.claims = '{\"role\":\"commerce_cart_quota\"}'; SET request.method='POST'; SET request.path='/rpc/unrelated'; SELECT public.enforce_gigl_tracking_worker_request_scope()"), /outside its capability scope/);
});

