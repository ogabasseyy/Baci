import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  baseBody,
  mockRpc,
  POST,
  request,
  setMerchantRow,
} from './route.test-support';

describe('POST /api/storefront/discount/validate merchant codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMerchantRow(null);
  });

  it('returns the merchant code without calling the loyalty resolve', async () => {
    const rpc = mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? [
            {
              id: '33333333-3333-4333-8333-333333333333',
              code: 'SAVE10',
              discount_type: 'percentage',
              discount_value: 10,
              starts_at: null,
              expires_at: null,
              usage_limit: null,
              usage_count: 0,
              minimum_purchase_amount: null,
              maximum_discount_amount: null,
              description: null,
              applies_to: 'all',
              product_ids: [],
              category_ids: [],
              usage_limit_per_customer: null,
            },
          ]
        : []
    );

    const response = await POST(request({ ...baseBody, code: 'SAVE10' }));
    const body = await response.json();

    expect(body.valid).toBe(true);
    expect(body.discount_code_id).toBe('33333333-3333-4333-8333-333333333333');
    expect(
      rpc.mock.calls.some(
        ([fn]) => fn === 'get_loyalty_redemption_for_checkout'
      )
    ).toBe(false);
  });
  it('returns 500 when the merchant lookup fails instead of invalid', async () => {
    mockRpc(() => [], {
      rpc: { get_storefront_discount_code: new Error('boom') },
    });

    const response = await POST(request(baseBody));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      valid: false,
      error: 'Internal server error',
    });
  });
  it('rejects invalid input before any lookup', async () => {
    const rpc = mockRpc(() => []);

    const response = await POST(request({ code: 'x' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.valid).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
