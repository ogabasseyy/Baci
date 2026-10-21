import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
const migration = readFileSync(new URL('../migrations/20261022001000_mcp_guest_oauth_records.sql', import.meta.url), 'utf8');
test('OAuth CAS enforces tenant, lifetime and worker-only access in PostgreSQL', () => {
  const bin = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
  const dir = mkdtempSync(join(tmpdir(), 'guest-oauth-pg-'));
  let started = false;
  try {
    execFileSync(join(bin, 'initdb'), ['-D', `${dir}/data`, '-A', 'trust', '--no-locale', '-U', 'postgres'], { stdio: 'pipe' });
    execFileSync(join(bin, 'pg_ctl'), ['-D', `${dir}/data`, '-l', `${dir}/server.log`, '-o', `-k ${dir} -h '' -p 65438`, '-w', 'start'], { stdio: 'pipe' });
    started = true;
    const query = (sql) => execFileSync(join(bin, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-h', dir, '-p', '65438', '-U', 'postgres', '-d', 'postgres', '-qAt'], { input: sql, encoding: 'utf8', stdio: 'pipe' }).trim();
    const tenant = '11111111-1111-4111-8111-111111111111';
    const other = '22222222-2222-4222-8222-222222222222';
    query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE authenticator; CREATE TABLE public.merchants(id uuid PRIMARY KEY); INSERT INTO public.merchants VALUES('${tenant}'),('${other}'); ${migration}`);
    const worker = `SET ROLE mcp_guest_oauth_worker; SET request.jwt.claims='{"role":"mcp_guest_oauth_worker","merchant_id":"${tenant}"}';`;
    const cas = (revision, expiry = "now()+interval '1 day'") => `SELECT public.mcp_guest_oauth_cas('${tenant}','grant:test',${revision},repeat('x',64),${expiry});`;
    assert.equal(query(worker + cas(0)), 't');
    assert.equal(query(worker + cas(0)), 'f');
    assert.equal(query(worker + cas(1)), 't');
    assert.equal(query(worker + cas(1)), 'f');
    assert.equal(query(worker + `SELECT revision FROM public.mcp_guest_oauth_read('${tenant}','grant:test');`), '2');
    assert.throws(() => query(worker + `SELECT * FROM public.mcp_guest_oauth_read('${other}','grant:test');`), /unauthorized/);
    assert.throws(() => query(worker + 'SELECT ciphertext FROM public.mcp_guest_oauth_records;'), /permission denied/);
    assert.throws(() => query(`SET ROLE anon; SELECT * FROM public.mcp_guest_oauth_read('${tenant}','grant:test');`), /permission denied/);
    assert.throws(() => query(worker + cas(2, "now()+interval '8 days'")), /invalid_expiry/);
    query(`INSERT INTO public.mcp_guest_oauth_records(merchant_id,record_key,ciphertext,revision,created_at,expires_at) VALUES
      ('${tenant}','grant:expired',repeat('x',64),1,now()-interval '2 days',now()-interval '1 day'),
      ('${other}','grant:expired',repeat('x',64),1,now()-interval '2 days',now()-interval '1 day');`);
    assert.equal(query(worker + `SELECT public.mcp_guest_oauth_purge_expired('${tenant}');`), '1');
    assert.equal(query(`SELECT count(*) FROM public.mcp_guest_oauth_records WHERE merchant_id='${other}';`), '1');
    assert.equal(query('SELECT relrowsecurity FROM pg_class WHERE oid=\'public.mcp_guest_oauth_records\'::regclass;'), 't');
  } finally {
    if (started) execFileSync(join(bin, 'pg_ctl'), ['-D', `${dir}/data`, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
    rmSync(dir, { recursive: true, force: true });
  }
});
