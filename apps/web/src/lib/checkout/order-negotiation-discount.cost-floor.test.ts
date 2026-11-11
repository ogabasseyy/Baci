import { describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('./negotiation-cost-floor-monitor', () => ({
  monitorNegotiationCostFloor: vi.fn().mockResolvedValue(undefined),
}));

import { computeOrderNegotiationDiscount } from './order-negotiation-discount';

function supabase(floor: number) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    overrideTypes: vi.fn(() =>
      Promise.resolve({
        data: [
          {
            id: 'p1',
            name: 'MacBook Air M1',
            brand: 'Apple',
            price: 1000,
            condition: null,
            vat_category_code: 'S',
            vat_rate: 7.5,
          },
        ],
        error: null,
      })
    ),
  };
  return {
    from: vi.fn(() => query),
    rpc: vi.fn(() => Promise.resolve({ data: floor, error: null })),
  };
}

const run = (price: number, floor: number) =>
  computeOrderNegotiationDiscount({
    items: [{ product_id: 'p1', quantity: 1, price }],
    merchantId: 'm1',
    supabase: supabase(floor) as never,
    vatRegistered: true,
  });

describe('computeOrderNegotiationDiscount cost-floor enforcement', () => {
  it('rejects a 2% discount that lands under cost * 1.1 (bugfix: sold at or below cost)', async () => {
    const result = await run(980, 1100); // cost 1000 => floor 1100 > price
    expect(result?.rejectionCode).toBe('negotiated_price_below_floor');
    expect(result?.totalDiscount).toBe(0);
  });

  it('still accepts a 2% discount when cost leaves the margin intact', async () => {
    const result = await run(980, 980); // floor is just the 2% band
    expect(result?.rejectionCode).toBeNull();
    expect(result?.totalDiscount).toBeGreaterThan(0);
  });

  it('never blocks a full-price order even when cost exceeds price', async () => {
    const result = await run(1000, 1100);
    expect(result?.rejectionCode).toBeNull();
    expect(result?.totalDiscount).toBe(0);
  });
});
