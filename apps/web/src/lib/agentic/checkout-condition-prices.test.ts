import { describe, expect, it, vi } from 'vitest';
import { loadConditionPricesIsolated } from './checkout-condition-prices';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_A = '22222222-2222-4222-8222-222222222222';
const PRODUCT_B = '33333333-3333-4333-8333-333333333333';

function rpcClient(
  rows: {
    condition: string;
    price: number;
    product_id: string;
    status: string;
  }[]
) {
  return {
    rpc: vi.fn(async (_name: string, args: { p_product_ids: string[] }) => ({
      data: rows.filter((row) => args.p_product_ids.includes(row.product_id)),
      error: null,
    })),
  };
}

describe('loadConditionPricesIsolated', () => {
  it('returns no lanes for generic or new-condition items', async () => {
    const client = rpcClient([]);
    const result = await loadConditionPricesIsolated(
      client as never,
      MERCHANT_ID,
      [{ product_id: PRODUCT_A }, { condition: 'new', product_id: PRODUCT_A }]
    );
    expect(result.prices.size).toBe(0);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('isolates an unavailable lane from valid lanes', async () => {
    // Bulk load throws because one offer is inactive; the per-lane
    // fallback keeps the valid lane priced and marks only the offender.
    const client = rpcClient([
      {
        condition: 'used',
        price: 300,
        product_id: PRODUCT_A,
        status: 'active',
      },
      {
        condition: 'used',
        price: 200,
        product_id: PRODUCT_B,
        status: 'inactive',
      },
    ]);
    const result = await loadConditionPricesIsolated(
      client as never,
      MERCHANT_ID,
      [
        { condition: 'used', product_id: PRODUCT_A },
        { condition: 'used', product_id: PRODUCT_B },
      ]
    );
    expect(result.prices.get(JSON.stringify([PRODUCT_A, 'used']))).toBe(300);
    expect(result.unavailable).toEqual(
      new Set([JSON.stringify([PRODUCT_B, 'used'])])
    );
  });
});
