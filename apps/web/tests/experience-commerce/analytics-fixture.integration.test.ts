import { expect, it } from 'vitest';
import { prepareAnalyticsFixture } from './analytics-fixture';
import { createCommerceEngineFixture } from './cart-engine-fixture';
import { prepareCommerceCatalog } from './catalog-fixture';

it('uses actual scoped anonymous ingress RLS, rejecting absent and wrong-tenant capabilities', async () => {
  const f = await createCommerceEngineFixture();
  try {
    const ids = await prepareCommerceCatalog(f);
    await prepareAnalyticsFixture(f);
    const stamp = new Date().toISOString();
    const claims = {
      role: 'anon',
      baci_event_ingress_kind: 'analytics',
      baci_event_ingress_merchant_id: ids.merchant,
      baci_event_ingress_event_type: 'page_view',
      baci_event_ingress_event_id: 'synthetic-view',
      baci_event_ingress_event_timestamp_ms: String(Date.parse(stamp)),
      baci_event_ingress_producer: 'web',
      baci_event_ingress_source: 'web',
      baci_event_ingress_trust_level: 'anonymous_client',
    };
    const insert = async (jwt: Record<string, unknown>) => {
      const c = await f.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE anon');
        await c.query("SELECT set_config('request.jwt.claims',$1,true)", [
          JSON.stringify(jwt),
        ]);
        await c.query(
          "INSERT INTO analytics_events(merchant_id,event_type,event_data,event_timestamp,event_id,source) VALUES($1,'page_view','{}',$2,'synthetic-view','web')",
          [ids.merchant, stamp]
        );
        await c.query('COMMIT');
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      } finally {
        c.release();
      }
    };
    await expect(insert({ role: 'anon' })).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      insert({
        ...claims,
        baci_event_ingress_merchant_id: '22222222-2222-4222-8222-222222222222',
      })
    ).rejects.toMatchObject({ code: '42501' });
    await expect(insert(claims)).resolves.toBeUndefined();
    expect(
      (await f.pool.query('SELECT count(*) FROM analytics_events')).rows[0]
        .count
    ).toBe('1');
    expect(
      (await f.pool.query('SELECT count(*) FROM orders')).rows[0].count
    ).toBe('0');
  } finally {
    await f.close();
  }
});
