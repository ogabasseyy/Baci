import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminOrderGiglCustomerPaidConflict } from './admin-order-gigl-customer-paid-conflict';

const loaders = vi.hoisted(() => ({
  settled: vi.fn(),
  internalCredit: vi.fn(),
}));
vi.mock('@/lib/shipping/load-order-gigl-settled-retained-amount', () => ({
  loadOrderGiglSettledRetainedAmount: loaders.settled,
}));
vi.mock(
  '@/lib/shipping/load-order-gigl-internal-credit-retained-amount',
  () => ({
    loadOrderGiglInternalCreditRetainedAmount: loaders.internalCredit,
  })
);

const supabase = {} as SupabaseClient;
const checkoutOrder = { shipping_funding_source: 'customer_checkout' };

function check(order: { shipping_funding_source?: string | null }) {
  return getAdminOrderGiglCustomerPaidConflict(
    supabase,
    'merchant-1',
    'order-1',
    order
  );
}

describe('getAdminOrderGiglCustomerPaidConflict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loaders.settled.mockResolvedValue(0);
    loaders.internalCredit.mockResolvedValue(0);
  });

  it('refuses when settlement retained the customer paid GIG shipping', async () => {
    loaders.settled.mockResolvedValue(2500);

    const response = await check(checkoutOrder);

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      code: 'CUSTOMER_PAID_GIGL_SHIPPING',
      error:
        'The customer already paid for GIG delivery at checkout. Book this order from Ship Order to use the price they paid.',
    });
    expect(loaders.settled).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1'
    );
    expect(loaders.internalCredit).not.toHaveBeenCalled();
  });

  it('refuses when only wallet or store-credit checkout retained the shipping', async () => {
    loaders.internalCredit.mockResolvedValue(1100);

    const response = await check(checkoutOrder);

    expect(response?.status).toBe(409);
    expect(loaders.internalCredit).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1',
      { shipping_funding_source: 'customer_checkout' }
    );
  });

  it('bugfix: allows the wallet path for a checkout order with nothing retained (Credit Direct, quiz voucher, unsettled)', async () => {
    await expect(check(checkoutOrder)).resolves.toBeNull();
  });

  it.each([
    'merchant_wallet',
    null,
    undefined,
  ] as const)('does not look up retention for an order funded by %s', async (shipping_funding_source) => {
    await expect(check({ shipping_funding_source })).resolves.toBeNull();
    expect(loaders.settled).not.toHaveBeenCalled();
    expect(loaders.internalCredit).not.toHaveBeenCalled();
  });

  it.each([
    'settled',
    'internalCredit',
  ] as const)('fails closed with a safe message when the %s lookup fails', async (failing) => {
    loaders[failing].mockRejectedValue(new Error('db detail must not leak'));

    const response = await check(checkoutOrder);

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({
      code: 'CHECKOUT_SHIPPING_PAYMENT_LOOKUP_FAILED',
      error:
        'Could not check what the customer paid for delivery. Please try again.',
    });
  });
});
