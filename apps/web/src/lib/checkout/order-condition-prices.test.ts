import { describe, expect, it, vi } from 'vitest';
import { computeAgenticOrderTax } from '../agentic/checkout-order-tax';
import { computeCanonicalOrderSubtotal } from './canonical-order-subtotal';
import {
  loadOrderConditionPrices,
  orderConditionPrice,
} from './order-condition-prices';
import { computeOrderNegotiationDiscount } from './order-negotiation-discount';

const item = {
  product_id: 'p1',
  condition: 'used',
  quantity: 2,
  assurance_fee: 0,
};
function client() {
  const query = {
    maybeSingle: vi.fn(async () => ({
      data: { vat_registration_status: 'registered' },
      error: null,
    })),
    overrideTypes: vi.fn(async () => ({
      data: [
        {
          id: 'p1',
          price: 100,
          name: 'iPhone',
          brand: 'Apple',
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
      error: null,
    })),
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    returns: vi.fn(async () => ({
      data: [
        {
          id: 'p1',
          price: 100,
          name: 'iPhone',
          brand: 'Apple',
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
      error: null,
    })),
  };
  return {
    from: vi.fn(() => query),
    rpc: vi.fn(async () => ({
      data: [
        { product_id: 'p1', condition: 'used', price: 60, status: 'active' },
      ],
      error: null,
    })),
  };
}
describe('condition offer order parity', () => {
  it('computes the subtotal using the selected condition offer instead of parent price', async () => {
    expect(
      await computeCanonicalOrderSubtotal({
        items: [item],
        merchantId: 'm1',
        supabase: client() as never,
      })
    ).toBe(120);
  });
  it('uses condition price for tax and negotiation floors', async () => {
    const db = client();
    expect(
      await computeAgenticOrderTax({
        items: [item],
        merchantId: 'm1',
        supabase: db as never,
      })
    ).toBe(9);
    const discount = await computeOrderNegotiationDiscount({
      items: [{ ...item, price: 60 }],
      merchantId: 'm1',
      supabase: db as never,
      vatRegistered: true,
    });
    expect(discount?.rejectionCode).toBeNull();
    expect(discount?.totalDiscount).toBe(0);
  });
  it('scopes pricing to the merchant and requested nonvariant products', async () => {
    const db = client();
    const prices = await loadOrderConditionPrices([item], 'm1', db as never);
    expect(db.rpc).toHaveBeenCalledWith('get_order_condition_prices', {
      p_merchant_id: 'm1',
      p_product_ids: ['p1'],
    });
    expect(orderConditionPrice(prices, item)).toBe(60);
    expect(
      orderConditionPrice(prices, { ...item, variant_id: 'v1' })
    ).toBeUndefined();
  });
  it('fails on lookup errors instead of silently using parent pricing', async () => {
    const db = {
      rpc: vi.fn(async () => ({ data: null, error: { code: '42501' } })),
    };
    await expect(
      loadOrderConditionPrices([item], 'm1', db as never)
    ).rejects.toThrow('Unable to resolve');
  });
  it('rejects an inactive selected offer but allows unrelated inactive conditions', async () => {
    const db = {
      rpc: vi.fn(async () => ({
        data: [
          {
            product_id: 'p1',
            condition: 'used',
            price: null,
            status: 'inactive',
          },
        ],
        error: null,
      })),
    };
    await expect(
      loadOrderConditionPrices([item], 'm1', db as never)
    ).rejects.toThrow('Condition offer unavailable');
    await expect(
      loadOrderConditionPrices(
        [{ ...item, condition: 'new' }],
        'm1',
        db as never
      )
    ).resolves.toEqual(new Map());
  });
  it('prices a deactivated offer at its stored price for idempotent replays', async () => {
    const db = {
      rpc: vi.fn(async () => ({
        data: [
          {
            product_id: 'p1',
            condition: 'used',
            price: 60,
            status: 'inactive',
          },
        ],
        error: null,
      })),
    };
    const prices = await loadOrderConditionPrices([item], 'm1', db as never, {
      allowUnavailable: true,
    });
    expect(orderConditionPrice(prices, item)).toBe(60);
  });

  it('does not query for omitted conditions or variants', async () => {
    const db = client();
    await loadOrderConditionPrices(
      [{ product_id: 'p1' }, { ...item, variant_id: 'v1' }],
      'm1',
      db as never
    );
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
