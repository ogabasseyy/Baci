import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommerceEngineFixture } from './cart-engine-fixture.ts';
import { prepareCommerceCatalog } from './catalog-fixture.ts';

test('synthetic origin and rate are owner/RLS writes; anonymous reads published safe projections', async () => {
  const f = await createCommerceEngineFixture();
  try {
    const { merchant } = await prepareCommerceCatalog(f);
    const c = await f.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE anon');
      const r = await c.query(
        'SELECT get_storefront_shipping_rates($1) value',
        [merchant]
      );
      assert.equal(r.rows[0].value.rates[0].base_amount, 1500);
      assert.deepEqual(r.rows[0].value.shipping_providers, []);
      await assert.rejects(
        c.query('SELECT user_id FROM merchants'),
        /permission denied/
      );
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
    assert.equal(
      (await f.pool.query('SELECT count(*) FROM orders')).rows[0].count,
      '0'
    );
  } finally {
    await f.close();
  }
});
