import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { experienceSqlFixture } from './fixture.ts';

const load = (name: string) =>
  readFileSync(
    new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
    'utf8'
  );
test('normal anonymous RPC requires server attestation, immutable quote identity and exact merchant/session read scope', async () => {
  const f = await experienceSqlFixture();
  try {
    const baseline = load('20260418000000_baseline.sql');
    const table = baseline.slice(
      baseline.indexOf('CREATE TABLE IF NOT EXISTS "public"."shipping_quotes"'),
      baseline.indexOf('ALTER TABLE "public"."shipping_quotes" OWNER')
    );
    await f.pool.query(
      table +
        `;ALTER TABLE shipping_quotes ADD PRIMARY KEY(id);ALTER TABLE shipping_quotes ADD COLUMN merchant_id uuid REFERENCES merchants(id);ALTER TABLE shipping_quotes ENABLE ROW LEVEL SECURITY;CREATE SCHEMA IF NOT EXISTS extensions;CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;CREATE SCHEMA IF NOT EXISTS private;CREATE SCHEMA vault;CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);CREATE OR REPLACE FUNCTION public.has_merchant_access(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;CREATE TABLE IF NOT EXISTS orders(id uuid);`
    );
    await f.pool.query(load('20260901190000_add_gigl_quote_economics.sql'));
    await f.pool.query(
      load(
        '20260903135000_attest_shipping_quote_writes_and_shipment_grants.sql'
      ).split('-- Remove the unproved')[0]
    );
    await f.pool.query(
      load('20261024160001_attested_storefront_shipping_quotes.sql')
    );
    const secret = `synthetic-${randomUUID()}`;
    await f.pool.query('INSERT INTO vault.decrypted_secrets VALUES($1,$2)', [
      'service_role_key',
      secret,
    ]);
    const merchant = randomUUID();
    const other = randomUUID();
    await f.pool.query(
      'INSERT INTO merchants(id,is_published) VALUES($1,true),($2,false)',
      [merchant, other]
    );
    const session = randomUUID();
    const quote = {
      id: randomUUID(),
      merchant_id: merchant,
      session_id: session,
      provider: 'GIGL',
      price: 1500,
      currency: 'NGN',
      expires_at: new Date(Date.now() + 600000).toISOString(),
      provider_cost: 1200,
      platform_margin: 300,
      quote_request: {
        merchantId: merchant,
        sessionId: session,
        sender: { address: 'synthetic private sender' },
      },
    };
    const proof = (
      action: string,
      subject: string,
      payload: object,
      m = merchant,
      issued_at = new Date().toISOString()
    ) => {
      const version = 'baci-shipping-quote-proof:v1';
      const payload_text = JSON.stringify(payload);
      const signature = createHmac('sha256', secret)
        .update(
          [
            'baci:shipping-quote-rpc:v1',
            version,
            action,
            subject,
            m,
            issued_at,
            payload_text,
          ].join('\n')
        )
        .digest('hex');
      return {
        version,
        action,
        subject_id: subject,
        merchant_id: m,
        issued_at,
        payload_text,
        signature,
      };
    };
    const anon = async (sql: string, args: unknown[]) => {
      const c = await f.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE anon');
        return await c.query(sql, args);
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
    };
    // Use committed transactions only for the exact approved synthetic provider fixture.
    const write = async (q: object, p: object) => {
      const c = await f.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE anon');
        const r = await c.query(
          'SELECT persist_storefront_shipping_quote($1,$2) id',
          [q, p]
        );
        await c.query('COMMIT');
        return r.rows[0].id;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    };
    const signed = proof('persist_storefront_shipping_quote', quote.id, {
      quote,
    });
    assert.equal(await write(quote, signed), quote.id);
    assert.equal(await write(quote, signed), quote.id);
    for (const q of [
      { ...quote, price: 1 },
      { ...quote, merchant_id: other },
      { ...quote, id: randomUUID() },
      { ...quote, session_id: 'swapped' },
    ])
      await assert.rejects(write(q, signed));
    await assert.rejects(
      write(
        quote,
        proof(
          'persist_storefront_shipping_quote',
          quote.id,
          { quote },
          merchant,
          new Date(Date.now() - 360000).toISOString()
        )
      )
    );
    await assert.rejects(
      write(
        { ...quote, price: 1 },
        proof('persist_storefront_shipping_quote', quote.id, {
          quote: { ...quote, price: 1 },
        })
      ),
      /quote_identity_conflict/
    );
    await assert.rejects(
      anon('SELECT provider_cost FROM shipping_quotes', []),
      /permission denied/
    );
    await assert.rejects(
      anon('INSERT INTO shipping_quotes(id) VALUES($1)', [randomUUID()]),
      /permission denied/
    );
    const subject = randomUUID();
    const rp = proof('read_storefront_shipping_quotes', subject, {
      merchant_id: merchant,
      session_id: session,
    });
    const rows = await anon(
      'SELECT * FROM read_storefront_shipping_quotes($1,$2,$3,$4)',
      [merchant, session, subject, rp]
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].price, '1500.00');
    assert.ok(!('provider_cost' in rows.rows[0]));
    assert.ok(!('quote_request' in rows.rows[0]));
    await assert.rejects(
      anon('SELECT * FROM read_storefront_shipping_quotes($1,$2,$3,$4)', [
        merchant,
        'swapped',
        subject,
        rp,
      ])
    );
    const readyId = randomUUID();
    const ready = proof('storefront_shipping_quote_storage_ready', readyId, {
      merchant_id: merchant,
    });
    assert.equal(
      (
        await anon(
          'SELECT storefront_shipping_quote_storage_ready($1,$2,$3) ready',
          [merchant, readyId, ready]
        )
      ).rows[0].ready,
      true
    );
    await f.pool.query(
      'UPDATE shipping_quotes SET provider_metadata=\'{"unattested":true}\'::jsonb'
    );
    await assert.rejects(write(quote, signed), /quote_identity_conflict/);
    await f.pool.query('DELETE FROM vault.decrypted_secrets');
    assert.equal(
      (
        await anon(
          'SELECT storefront_shipping_quote_storage_ready($1,$2,$3) ready',
          [merchant, readyId, ready]
        )
      ).rows[0].ready,
      false
    );
    assert.equal(
      (await f.pool.query('SELECT count(*) FROM shipping_quotes')).rows[0]
        .count,
      '1'
    );
    assert.equal(
      (await f.pool.query('SELECT count(*) FROM orders')).rows[0].count,
      '0'
    );
  } finally {
    await f.close();
  }
});
