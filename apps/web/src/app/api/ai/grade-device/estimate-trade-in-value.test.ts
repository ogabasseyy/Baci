import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => ({
  calls: [] as [string, ...unknown[]][],
  result: { data: [] as unknown, error: null as unknown },
}));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({
    from: (table: string) => {
      query.calls.push(['from', table]);
      const chain = new Proxy(
        {},
        {
          get: (_target, method: string) =>
            method === 'returns'
              ? () => Promise.resolve(query.result)
              : (...args: unknown[]) => {
                  query.calls.push([method, ...args]);
                  return chain;
                },
        }
      );
      return chain;
    },
  }),
}));

import { estimateTradeInValue } from './estimate-trade-in-value';

const grading = (grade: 'Excellent' | 'Good' | 'Fair' | 'Poor') => ({
  model: 'iPhone 13 Pro',
  grade,
  observations: [],
});

describe('estimateTradeInValue', () => {
  beforeEach(() => {
    query.calls = [];
    query.result = {
      data: [{ name: 'Apple iPhone 13 Pro 128GB', price: 500000 }],
      error: null,
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it.each([
    ['Excellent', 350000, 30],
    ['Good', 300000, 40],
    ['Fair', 250000, 50],
    ['Poor', 150000, 70],
  ] as const)('offers the %s share of the matched price', async (grade, estimatedValue, deductionPercent) => {
    expect(await estimateTradeInValue('merchant-1', grading(grade))).toEqual({
      basePrice: 500000,
      deductionPercent,
      estimatedValue,
      matchedProduct: 'Apple iPhone 13 Pro 128GB',
    });
  });

  it('asks only for the store’s cheapest active, priced match', async () => {
    await estimateTradeInValue('merchant-1', grading('Good'));

    expect(query.calls).toEqual([
      ['from', 'products'],
      ['select', 'name, price'],
      ['eq', 'merchant_id', 'merchant-1'],
      ['eq', 'status', 'active'],
      ['ilike', 'name', '%iPhone 13 Pro%'],
      ['gt', 'price', 0],
      ['order', 'price', { ascending: true }],
      ['limit', 25],
    ]);
  });

  it('skips cheaper accessory listings that contain the model name', async () => {
    query.result = {
      data: [
        { name: 'iPhone 13 Pro Silicone Case', price: 5000 },
        { name: 'Tempered Glass for iPhone 13 Pro', price: 3000 },
        { name: 'Apple iPhone 13 Pro 128GB', price: 500000 },
        { name: 'Apple iPhone 13 Pro 1TB', price: 800000 },
      ],
      error: null,
    };

    const estimate = await estimateTradeInValue('merchant-1', grading('Good'));

    expect(estimate.matchedProduct).toBe('Apple iPhone 13 Pro 128GB');
    expect(estimate.estimatedValue).toBe(300000);
  });

  it('gives no estimate when only accessories match', async () => {
    query.result = {
      data: [{ name: 'iPhone 13 Pro Charger', price: 8000 }],
      error: null,
    };

    const estimate = await estimateTradeInValue('merchant-1', grading('Good'));

    expect(estimate.estimatedValue).toBe(0);
    expect(estimate.matchedProduct).toBe('Unknown Device');
  });

  it('does not treat a device whose name merely contains an accessory word as one', async () => {
    query.result = {
      data: [{ name: 'Samsung Galaxy Showcase Edition', price: 200000 }],
      error: null,
    };

    const estimate = await estimateTradeInValue('merchant-1', grading('Good'));

    expect(estimate.basePrice).toBe(200000);
  });

  it('escapes pattern characters in the model name', async () => {
    await estimateTradeInValue('merchant-1', {
      ...grading('Good'),
      model: '50%_off\\',
    });

    expect(query.calls).toContainEqual(['ilike', 'name', '%50\\%\\_off\\\\%']);
  });

  it.each([
    ['nothing matches', { data: [], error: null }],
    ['the lookup returns no rows object', { data: null, error: null }],
    [
      'the matched price is not a number',
      {
        data: [{ name: 'Broken', price: Number.NaN }],
        error: null,
      },
    ],
  ])('returns no estimate when %s', async (_label, result) => {
    query.result = result;

    expect(await estimateTradeInValue('merchant-1', grading('Good'))).toEqual({
      basePrice: 0,
      deductionPercent: 40,
      estimatedValue: 0,
      matchedProduct: 'Unknown Device',
    });
  });

  it('returns no estimate and logs only the error code when the lookup fails', async () => {
    query.result = {
      data: [{ name: 'Stale row', price: 900000 }],
      error: { code: '42501', message: 'permission denied for table products' },
    };

    const estimate = await estimateTradeInValue('merchant-1', grading('Good'));

    expect(estimate.estimatedValue).toBe(0);
    expect(estimate.matchedProduct).toBe('Unknown Device');
    expect(console.error).toHaveBeenCalledWith(
      '[grade-device] product lookup failed',
      { code: '42501' }
    );
  });
});
