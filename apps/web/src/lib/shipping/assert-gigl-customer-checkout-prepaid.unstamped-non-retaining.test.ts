import { describe, expect, it } from 'vitest';
import { assertGiglCustomerCheckoutPrepaid } from './assert-gigl-customer-checkout-prepaid';

describe('bugfix: paid non-retaining order with null funding source', () => {
  it.each([
    'credit_direct',
    'cash',
    'manual',
    'oxygen',
    'bank_transfer',
    'some_future_provider',
  ])('requires wallet funding for a paid %s order that was unstamped', async (payment_method) => {
    await expect(
      assertGiglCustomerCheckoutPrepaid({
        shipping_provider: 'GIGL',
        shipping_funding_source: null,
        payment_status: 'paid',
        payment_method,
      })
    ).rejects.toMatchObject({ code: 'GIGL_REQUIRES_PREPAID_OR_WALLET' });
  });

  it.each([
    'paystack',
    'card',
    'juicyway',
    'wallet',
  ])('keeps the legacy paid path for allow-listed %s with null funding', async (payment_method) => {
    await expect(
      assertGiglCustomerCheckoutPrepaid({
        shipping_provider: 'GIGL',
        shipping_funding_source: null,
        payment_status: 'paid',
        payment_method,
      })
    ).resolves.toBeUndefined();
  });
});

describe('bugfix: stamped order with a non-allow-listed method but settled retention', () => {
  const stamped = {
    shipping_provider: 'GIGL',
    shipping_funding_source: 'customer_checkout',
    shipping_platform_retained_amount: 11500,
    payment_status: 'paid',
    payment_method: 'bank_transfer',
  } as const;

  it('allows booking when the settlement proves Baci holds the full tariff', async () => {
    await expect(
      assertGiglCustomerCheckoutPrepaid(stamped, {
        supabase: {} as never,
        merchantId: 'merchant-1',
        orderId: 'order-1',
        settledRetainedAmount: 11500,
      })
    ).resolves.toBeUndefined();
  });

  it('refuses booking when nothing was settled to Baci', async () => {
    await expect(
      assertGiglCustomerCheckoutPrepaid(stamped, {
        supabase: {} as never,
        merchantId: 'merchant-1',
        orderId: 'order-1',
        settledRetainedAmount: 0,
      })
    ).rejects.toMatchObject({ code: 'GIGL_REQUIRES_PREPAID_OR_WALLET' });
  });
});
