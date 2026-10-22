import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
const seedMigration = readFileSync(new URL('../migrations/20261022010357_mcp_guest_oauth_cart_ownership.sql', import.meta.url), 'utf8');
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
    query(`ALTER TABLE public.merchants ADD COLUMN premium_features jsonb DEFAULT '["shared_cart"]';
      CREATE TABLE public.mcp_guest_carts(token text PRIMARY KEY,items jsonb NOT NULL,expires_at timestamptz NOT NULL,merchant_id uuid,version bigint DEFAULT 1);
      CREATE FUNCTION public.upsert_mcp_guest_cart(text,jsonb,timestamptz,bigint) RETURNS TABLE(version bigint,outcome text) LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO public.mcp_guest_carts(token,items,expires_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING;
        IF FOUND THEN RETURN QUERY SELECT 1::bigint,'ok'::text; ELSE RETURN QUERY SELECT NULL::bigint,'conflict'::text; END IF;
      END $$;
      ${seedMigration}`);
    const worker = `SET ROLE mcp_guest_oauth_worker; SET request.jwt.claims='{"role":"mcp_guest_oauth_worker","merchant_id":"${tenant}"}';`;
    const cas = (revision, expiry = "now()+interval '1 day'") => `SELECT public.mcp_guest_oauth_cas('${tenant}','grant:test',${revision},repeat('x',64),${expiry});`;
    const token = 'a'.repeat(64);
    const seed = (merchant = tenant, handle = token) => `SELECT public.mcp_guest_oauth_seed_cart('${merchant}','${handle}',now()+interval '1 day');`;
    assert.equal(query(worker + seed()), 't');
    assert.equal(query(`SELECT merchant_id::text||':'||jsonb_array_length(items)::text FROM public.mcp_guest_carts WHERE token='${token}';`), `${tenant}:0`);
    query(`UPDATE public.mcp_guest_carts SET items='[{"product_id":"${other}","quantity":1}]' WHERE token='${token}';`);
    assert.equal(query(worker + seed()), 't');
    assert.equal(query(`SELECT jsonb_array_length(items) FROM public.mcp_guest_carts WHERE token='${token}';`), '1');
    assert.throws(() => query(worker + seed(other)), /unauthorized/);
    assert.throws(() => query(`SET ROLE anon; ${seed()}`), /permission denied/);
    const foreign = 'b'.repeat(64), ownerless = 'c'.repeat(64);
    query(`INSERT INTO public.mcp_guest_carts(token,items,expires_at,merchant_id) VALUES('${foreign}','[]',now()+interval '1 day','${other}'),('${ownerless}','[]',now()+interval '1 day',NULL);`);
    assert.equal(query(worker + seed(tenant, foreign)), 'f');
    assert.equal(query(worker + seed(tenant, ownerless)), 'f');
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
