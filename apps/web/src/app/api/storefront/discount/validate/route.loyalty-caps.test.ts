import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  baseBody,
  loyaltyRow,
  mockRpc,
  POST,
  request,
  setAnonClient,
  setMerchantRow,
} from './route.test-support';

describe('POST /api/storefront/discount/validate loyalty caps and currency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMerchantRow(null);
  });

  it('caps the preview discount at the snapshotted max redemption percentage', async () => {
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [loyaltyRow({ reward_value: 5000, max_redemption_percentage: 25 })]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body.valid).toBe(true);
    expect(body.discount_amount).toBe(2500);
    expect(body.discount_value).toBe(2500);
  });

  it('reports the effective percentage once the cap binds', async () => {
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [
            loyaltyRow({
              reward_type: 'discount_percentage',
              reward_value: 75,
              max_redemption_percentage: 25,
            }),
          ]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body.valid).toBe(true);
    expect(body.discount_amount).toBe(2500);
    expect(body.discount_value).toBe(25);
  });
  it('collapses a percentage code whose discount rounds to zero', async () => {
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [
            loyaltyRow({
              reward_type: 'discount_percentage',
              reward_value: 10,
            }),
          ]
    );

    const body = await (
      await POST(request({ ...baseBody, cart_total: 4 }))
    ).json();

    expect(body).toEqual({ valid: false, error: 'Invalid discount code' });
  });
  it('collapses a minimum-carrying percentage code after a currency change', async () => {
    setMerchantRow({ country: 'US', payout_currency: 'USD' });
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [
            loyaltyRow({
              reward_type: 'discount_percentage',
              reward_value: 10,
              minimum_order_amount: 5000,
            }),
          ]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body).toEqual({ valid: false, error: 'Invalid discount code' });
  });
  it('reports invalid, not the minimum, for a currency-dead code below its minimum', async () => {
    setMerchantRow({ country: 'US', payout_currency: 'USD' });
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [loyaltyRow({ minimum_order_amount: 50000 })]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body).toEqual({ valid: false, error: 'Invalid discount code' });
  });

  it('rejects a code whose purchase minimum is unknowable', async () => {
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [loyaltyRow({ minimum_known: false })]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body).toEqual({ valid: false, error: 'Invalid discount code' });
  });

  it('rejects an over-100 percentage code as invalid', async () => {
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code'
        ? []
        : [
            loyaltyRow({
              reward_type: 'discount_percentage',
              reward_value: 150,
            }),
          ]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body).toEqual({ valid: false, error: 'Invalid discount code' });
  });

  it('collapses a fixed code to invalid after a merchant currency change', async () => {
    setMerchantRow({ country: 'US', payout_currency: 'USD' });
    mockRpc((fn) =>
      fn === 'get_storefront_discount_code' ? [] : [loyaltyRow()]
    );

    const body = await (await POST(request(baseBody))).json();

    expect(body).toEqual({ valid: false, error: 'Invalid discount code' });
  });
});
