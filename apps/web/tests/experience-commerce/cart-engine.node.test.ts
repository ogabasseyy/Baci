import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommerceEngineFixture } from './cart-engine-fixture.ts';

test('normal scoped engine lazy-create and response-loss replay settle once through checkout review without orders', async () => {
  const f = await createCommerceEngineFixture();
  try {
    const claims = {
      role: 'commerce_cart_shopper',
      exp: Math.floor(Date.now() / 1000) + 3600,
      cart_scope: 'bootstrap',
      cart_merchant_id: '11111111-1111-4111-8111-111111111111',
      cart_principal_id: 'synthetic-experience-guest',
    };
    const created = await f.call(claims, 'commerce_cart_create', [
      'experience-create',
      [],
      'NGN',
    ]);
    assert.equal(created.ok, true, JSON.stringify(created));
    const session = {
      ...claims,
      cart_scope: 'session',
      cart_id:
        created.state.cartId ?? created.state.cart_id ?? created.state.id,
      cart_grant_id: created.grantId,
    };
    const command = {
      type: 'add',
      item: { productId: '33333333-3333-4333-8333-333333333333' },
      quantity: 1,
    };
    const first = await f.call(session, 'commerce_cart_mutate', [
      session.cart_id,
      'experience-add',
      1,
      command,
    ]);
    assert.equal(first.ok, true, JSON.stringify(first));
    const replay = await f.call(session, 'commerce_cart_mutate', [
      session.cart_id,
      'experience-add',
      1,
      command,
    ]);
    assert.equal(replay.ok, true);
    assert.equal(replay.replayed, true);
    const state = await f.call(session, 'commerce_cart_snapshot', [
      session.cart_id,
    ]);
    assert.equal(state.ok, true);
    const version = state.state.version;
    const review = await f.call(session, 'commerce_cart_prepare_checkout', [
      session.cart_id,
      version,
      'experience-review',
    ]);
    assert.equal(review.ok, true, JSON.stringify(review));
    assert.equal(
      (await f.pool.query('SELECT count(*) FROM orders')).rows[0].count,
      '0'
    );
    assert.equal(
      (
        await f.pool.query(
          'SELECT count(*) FROM commerce_cart_lines WHERE cart_id=$1',
          [session.cart_id]
        )
      ).rows[0].count,
      '1'
    );
  } finally {
    await f.close();
  }
});
