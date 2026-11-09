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
