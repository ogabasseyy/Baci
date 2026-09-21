import { describe, expect, it, vi } from 'vitest';
import { getRedvaultCheckoutSummary } from './get-redvault-checkout-summary';

const orderId = '44444444-4444-4444-8444-444444444444';
const summaryRow = {
  order_id: orderId,
  total: '117.5',
  currency: 'NGN',
  tracking_token: 'track-1',
  payment_method: 'uba_redvault',
  payment_status: 'unpaid',
  product_subtotal_kobo: '11000',
  eligible_subtotal_kobo: '10000',
  ineligible_subtotal_kobo: '1000',
  discount_kobo: '500',
  assurance_fee_kobo: '0',
  tax_kobo: '750',
  shipping_kobo: '500',
  gift_wrapping_kobo: '0',
  payable_kobo: '11750',
  mixed_basket: true,
};

describe('getRedvaultCheckoutSummary', () => {
  it.each([
    { tax_kobo: '750.5' },
    { tax_kobo: '750.000000000000000001' },
    { shipping_kobo: Number.MAX_SAFE_INTEGER + 1 },
    { gift_wrapping_kobo: '9007199254740993' },
    { discount_kobo: -1 },
    { tax_kobo: 'NaN' },
    { tax_kobo: '0x2ee' },
    { tax_kobo: '7.5e2' },
    { tax_kobo: null },
    { tax_kobo: 751 },
    { shipping_kobo: 501 },
    { gift_wrapping_kobo: 1 },
    { discount_kobo: 501 },
    { total: '117.501' },
    { total: -117.5 },
    { eligible_subtotal_kobo: 9999 },
    { mixed_basket: false },
    {
      discount_kobo: 10001,
      payable_kobo: 2249,
      total: 22.49,
    },
  ])('rejects malformed or inconsistent RPC amounts: %j', async (override) => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...summaryRow, ...override }],
      error: null,
    });
    await expect(
      getRedvaultCheckoutSummary({ client: { rpc } as never, orderId })
    ).rejects.toThrow('redvault_checkout_summary_invalid');
  });

  it('returns only the persisted server summary with snake_case fields', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [summaryRow], error: null });
    await expect(
      getRedvaultCheckoutSummary({ client: { rpc } as never, orderId })
    ).resolves.toEqual({
      order: {
        id: orderId,
        total: 117.5,
        currency: 'NGN',
        tracking_token: 'track-1',
        payment_method: 'uba_redvault',
        payment_status: 'unpaid',
      },
      quote: {
        product_subtotal_kobo: 11000,
        eligible_subtotal_kobo: 10000,
        ineligible_subtotal_kobo: 1000,
        discount_kobo: 500,
        assurance_fee_kobo: 0,
        tax_kobo: 750,
        shipping_kobo: 500,
        gift_wrapping_kobo: 0,
        payable_kobo: 11750,
        mixed_basket: true,
      },
    });
    expect(rpc).toHaveBeenCalledWith(
      'get_storefront_redvault_checkout_summary',
      { p_order_id: orderId }
    );
  });

  it('rejects a malformed persisted summary instead of calculating a fallback', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...summaryRow, payable_kobo: '1' }],
      error: null,
    });
    await expect(
      getRedvaultCheckoutSummary({ client: { rpc } as never, orderId })
    ).rejects.toThrow('redvault_checkout_summary_invalid');
  });
});
