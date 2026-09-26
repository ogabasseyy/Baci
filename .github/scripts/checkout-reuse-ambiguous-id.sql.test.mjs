import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const original = read('supabase/migrations/20260706203000_preserve_reused_order_shipping_address.sql');
const originalPrivate = original.slice(original.indexOf('CREATE OR REPLACE FUNCTION private.'), original.indexOf('CREATE OR REPLACE FUNCTION public.'));
const repair = read('supabase/migrations/20260926150000_fix_checkout_reuse_ambiguous_id.sql');
const orderId = '10000000-0000-4000-8000-000000000001';
const merchantId = '20000000-0000-4000-8000-000000000001';
const itemId = '30000000-0000-4000-8000-000000000001';
const call = (method, token = 'test-token', email = 'checkout@example.test', merchant = merchantId) => `SELECT payment_method FROM private.prepare_storefront_order_for_checkout('${orderId}', '${merchant}', '${token}', '${email}', '${method}')`;

test('pending card order resumes across methods without ambiguous ids or duplicate rows', () => {
  const bin = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
  const directory = mkdtempSync(join(tmpdir(), 'checkout-reuse-postgres-'));
  let running = false;
  try {
    execFileSync(join(bin, 'initdb'), ['-D', `${directory}/data`, '-A', 'trust', '--no-locale', '-U', 'postgres'], { stdio: 'pipe' });
    execFileSync(join(bin, 'pg_ctl'), ['-D', `${directory}/data`, '-l', `${directory}/server.log`, '-o', `-k ${directory} -h '' -p 65439`, '-w', 'start'], { stdio: 'pipe' });
    running = true;
    const query = (sql) => execFileSync(join(bin, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-h', directory, '-p', '65439', '-U', 'postgres', '-d', 'postgres', '-qAt'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    query(read('supabase/tests/checkout_reuse_ambiguous_id_fixture.sql'));
    query(originalPrivate);
    // One ordinary item reaches the order-level fulfillment update.
    assert.throws(() => query(call('bank_transfer')), /column reference "id" is ambiguous/);
    assert.equal(query('SELECT payment_method FROM public.orders'), 'card');
    // An existing serialized reservation fails earlier, in the item update.
    query(`INSERT INTO public.variant_inventory VALUES (gen_random_uuid(), '${itemId}', 'reserved', now(), now(), 'imei', 'fixture-serial')`);
    assert.throws(() => query(call('credit_direct')), /column reference "id" is ambiguous/);
    query(repair);
    for (const method of ['bank_transfer', 'credit_direct', 'credpal', 'invoice', 'pod', 'card']) {
      query("UPDATE public.orders SET payment_method='card', payment_status='unpaid'");
      assert.equal(query(call(method)), method);
      assert.equal(query('SELECT count(*) FROM public.orders'), '1');
      assert.equal(query('SELECT count(*) FROM public.order_items'), '1');
      assert.equal(query('SELECT count(*) FROM public.variant_inventory'), '1');
      assert.equal(query('SELECT total, shipping_address FROM public.orders'), '110|{"city": "Lagos"}');
      assert.equal(query('SELECT payment_status FROM public.orders'), method === 'pod' ? 'pending' : 'unpaid');
      assert.equal(query('SELECT reservation_expires_at IS NULL FROM public.variant_inventory'), method === 'pod' ? 't' : 'f');
      assert.equal(query('SELECT o.fulfillment_details = oi.fulfillment_data FROM public.orders o JOIN public.order_items oi ON oi.order_id=o.id'), 't');
    }
    // Without a reserved unit, the single-item summary path still succeeds.
    query('DELETE FROM public.variant_inventory');
    assert.equal(query(call('bank_transfer')), 'bank_transfer');
    assert.throws(() => query(call('card', 'wrong')), /unauthorized/);
    assert.throws(() => query(call('card', 'test-token', 'other@example.test')), /email_mismatch/);
    assert.throws(() => query(call('card', 'test-token', 'checkout@example.test', '20000000-0000-4000-8000-000000000002')), /merchant_mismatch/);
    for (const status of ['paid', 'bnpl_approved', 'refunded']) {
      query(`UPDATE public.orders SET payment_status='${status}'`);
      assert.throws(() => query(call('card')), /order_not_reusable/);
    }
    query("UPDATE public.orders SET payment_status='unpaid', shipping_status='cancelled'");
    assert.throws(() => query(call('card')), /order_not_reusable/);
  } finally {
    if (running) execFileSync(join(bin, 'pg_ctl'), ['-D', `${directory}/data`, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
    rmSync(directory, { recursive: true, force: true });
  }
});
