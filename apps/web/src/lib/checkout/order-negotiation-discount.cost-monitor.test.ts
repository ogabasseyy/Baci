import { beforeEach, describe, expect, it, vi } from 'vitest';

const monitor = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('./negotiation-cost-floor-monitor', () => ({
  monitorNegotiationCostFloor: monitor,
}));
const afterMock = vi.hoisted(() => vi.fn());
vi.mock('next/server', () => ({ after: afterMock }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));

import { computeOrderNegotiationDiscount } from './order-negotiation-discount';

function supabaseWithProduct() {
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
    rpc: vi.fn(
      (): Promise<{ data: unknown[]; error: null }> =>
        Promise.resolve({ data: [], error: null })
    ),
  };
}

const run = (price: number, monitorCostFloor?: boolean) =>
  computeOrderNegotiationDiscount({
    items: [{ product_id: 'p1', quantity: 1, price }],
    merchantId: 'm1',
    supabase: supabaseWithProduct() as never,
    vatRegistered: true,
    monitorCostFloor,
  });

describe('computeOrderNegotiationDiscount cost-floor monitor gate', () => {
  beforeEach(() => {
    monitor.mockClear();
    afterMock.mockReset();
    afterMock.mockImplementation((callback: () => unknown) => {
      void callback();
    });
  });

  it('observes an accepted discount when the route says it will be charged', async () => {
    await run(980, true);
    expect(monitor).toHaveBeenCalledTimes(1);
    expect(monitor.mock.calls[0][0]).toMatchObject({
      merchantId: 'm1',
      lines: [
        { productId: 'p1', catalogUnitPrice: 1000, clientUnitPrice: 980 },
      ],
    });
  });

  it('runs the monitor detached when after() throws outside a request scope', async () => {
    afterMock.mockImplementation(() => {
      throw new Error('outside request scope');
    });
    await expect(run(980, true)).resolves.toBeTruthy();
    expect(monitor).toHaveBeenCalledTimes(1);
  });

  it('does not observe when the discount will not be charged (flag off by default)', async () => {
    await run(980);
    await run(980, false);
    expect(monitor).not.toHaveBeenCalled();
  });

  it('does not observe a rejected below-floor price', async () => {
    const result = await run(900, true);
    expect(result?.rejectionCode).toBe('negotiated_price_below_floor');
    expect(monitor).not.toHaveBeenCalled();
  });

  it('does not observe a full-price line', async () => {
    await run(1000, true);
    expect(monitor).not.toHaveBeenCalled();
  });

  it('forwards no variant id when it does not belong to the line product (regression: foreign variant resolved another product cost)', async () => {
    const supabase = supabaseWithProduct();
    supabase.rpc = vi.fn(() =>
      Promise.resolve({
        data: [{ id: 'v-foreign', product_id: 'other', price_override: null }],
        error: null,
      })
    );
    await computeOrderNegotiationDiscount({
      items: [
        { product_id: 'p1', variant_id: 'v-foreign', quantity: 1, price: 980 },
      ],
      merchantId: 'm1',
      supabase: supabase as never,
      vatRegistered: true,
      monitorCostFloor: true,
    });
    expect(monitor.mock.calls[0][0].lines[0].variantId).toBeNull();
  });
});
