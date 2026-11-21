import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { ShippingQuote } from '@/lib/shipping/types';
import { selectAdminOrderGiglRate } from './select-admin-order-gigl-rate';

const order = {
  id: 'fixture-order',
  merchant_id: 'fixture-merchant',
  source: 'partner',
};
const cheaper = {
  provider: 'GIGL',
  currency: 'NGN',
  serviceTier: 'GoStandard',
  price: 1200,
} as ShippingQuote;
const settled = { ...cheaper, serviceTier: 'GoFaster', price: 1500 };

function fixture(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  return { rpc, db: { rpc } as unknown as SupabaseClient };
}

describe('admin GIG delivery rate selection', () => {
  it.each([
    1500, 1499.995,
  ])('selects the settled service at %s when its rounded fee matches', async (price) => {
    const candidate = { ...settled, price };
    const { db, rpc } = fixture({
      service: 'GoFaster',
      delivery_minor: 150000,
    });
    expect(
      await selectAdminOrderGiglRate(db, order, [cheaper, candidate])
    ).toEqual({ quote: candidate });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'read_settled_partner_delivery',
      {
        p_order_id: order.id,
        p_merchant_id: order.merchant_id,
      }
    );
  });

  it('uses the settlement when the order has no source label', async () => {
    const { db } = fixture({ service: 'GoFaster', delivery_minor: 150000 });
    expect(
      await selectAdminOrderGiglRate(db, { ...order, source: null }, [
        cheaper,
        settled,
      ])
    ).toEqual({ quote: settled });
  });

  it('returns a conflict if no rate matches the settled terms', async () => {
    const { db } = fixture({ service: 'GoFaster', delivery_minor: 150000 });
    const { error } = await selectAdminOrderGiglRate(db, order, [cheaper]);
    expect(error?.status).toBe(409);
    expect(await error?.json()).toMatchObject({
      code: 'PARTNER_DELIVERY_RATE_UNAVAILABLE',
    });
  });

  it('reports missing settlement as a conflict and malformed storage as unavailable', async () => {
    const missing = await selectAdminOrderGiglRate(fixture(null).db, order, [
      settled,
    ]);
    expect(missing.error?.status).toBe(409);
    expect(await missing.error?.json()).toMatchObject({
      code: 'PARTNER_DELIVERY_NOT_SETTLED',
    });
    const malformed = await selectAdminOrderGiglRate(
      fixture({ service: 'GoFaster' }).db,
      order,
      [settled]
    );
    expect(malformed.error?.status).toBe(503);
  });

  it('preserves normal cheapest-rate selection for other orders', async () => {
    const { db, rpc } = fixture(null);
    expect(
      await selectAdminOrderGiglRate(db, { ...order, source: 'online_store' }, [
        settled,
        cheaper,
      ])
    ).toEqual({ quote: cheaper });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'read_settled_partner_delivery',
      { p_order_id: order.id, p_merchant_id: order.merchant_id }
    );
  });
  it('preserves regular quotes during a settlement lookup failure', async () => {
    const { rpc, db } = fixture(null);
    rpc.mockResolvedValue({ data: null, error: { code: '08006' } });
    expect(
      await selectAdminOrderGiglRate(db, { ...order, source: 'online_store' }, [
        settled,
        cheaper,
      ])
    ).toEqual({ quote: cheaper });
    for (const source of ['partner', null, undefined]) {
      const result = await selectAdminOrderGiglRate(db, { ...order, source }, [
        cheaper,
      ]);
      expect(result.error?.status).toBe(503);
    }
  });
});
