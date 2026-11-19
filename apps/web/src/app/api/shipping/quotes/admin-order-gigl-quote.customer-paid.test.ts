import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  builtRequest,
  merchantId,
  mocks,
  orderId,
  quoteId,
  receiver,
  setup,
  subject,
} from './admin-order-gigl-quote.test-support';

const retention = vi.hoisted(() => ({
  settled: vi.fn(),
  internalCredit: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.authenticateApiRequest,
  getUserAccess: mocks.getUserAccess,
  hasPermission: mocks.hasPermission,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock('@/lib/shipping/persist-admin-gigl-quote', () => ({
  persistAdminGiglQuote: mocks.persistAdminGiglQuote,
}));
vi.mock('@/lib/shipping/build-order-gigl-quote-request', () => ({
  buildOrderGiglQuoteRequest: mocks.buildOrderGiglQuoteRequest,
}));
vi.mock('@/lib/shipping/resolve-booking-merchant-sender', () => ({
  resolveBookingMerchantSender: mocks.resolveBookingMerchantSender,
}));
vi.mock('@/lib/shipping', () => ({
  ShippingService: class MockShippingService {
    getProviderQuotes(...args: unknown[]) {
      return mocks.getProviderQuotes(...args);
    }
  },
}));
vi.mock('@/lib/shipping/load-order-gigl-settled-retained-amount', () => ({
  loadOrderGiglSettledRetainedAmount: retention.settled,
}));
vi.mock(
  '@/lib/shipping/load-order-gigl-internal-credit-retained-amount',
  () => ({
    loadOrderGiglInternalCreditRetainedAmount: retention.internalCredit,
  })
);

const checkoutOrder = (payment_method: string) => ({
  id: orderId,
  shipping_status: 'processing',
  shipping_funding_source: 'customer_checkout',
  payment_method,
  payment_status: 'paid',
});

describe('Admin GIGL quote for customer-checkout orders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retention.settled.mockResolvedValue(0);
    retention.internalCredit.mockResolvedValue(0);
  });

  it.each([
    false,
    true,
  ])('refuses a paid card order whose shipping Baci holds (preview %s) before quoting or binding', async (preview) => {
    setup({ order: checkoutOrder('paystack') });
    retention.settled.mockResolvedValue(2500);

    const response = await subject({
      receiver,
      ...(preview ? { preview } : {}),
    });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('CUSTOMER_PAID_GIGL_SHIPPING');
    expect(retention.settled).toHaveBeenCalledWith(
      expect.anything(),
      merchantId,
      orderId
    );
    expect(mocks.resolveBookingMerchantSender).not.toHaveBeenCalled();
    expect(mocks.getProviderQuotes).not.toHaveBeenCalled();
    expect(mocks.persistAdminGiglQuote).not.toHaveBeenCalled();
    expect(mocks.bindRpc).not.toHaveBeenCalled();
  });

  it('bugfix: keeps the wallet quote and bind open for a Credit Direct checkout order with nothing retained', async () => {
    setup({ order: checkoutOrder('credit_direct') });

    const response = await subject({ receiver });

    expect(response.status).toBe(200);
    expect(mocks.getProviderQuotes).toHaveBeenCalledOnce();
    expect(mocks.bindRpc).toHaveBeenCalledWith('bind_admin_gigl_quote', {
      p_order_id: orderId,
      p_merchant_id: merchantId,
      p_quote_id: quoteId,
      p_receiver: builtRequest.receiver,
    });
  });

  it('bugfix: maps the database rebind refusal to the customer-paid 409 instead of a 500', async () => {
    setup({ order: checkoutOrder('paystack') });
    mocks.bindRpc.mockResolvedValue({
      data: null,
      error: { message: 'customer_checkout_wallet_rebind_forbidden' },
    });

    const response = await subject({ receiver });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('CUSTOMER_PAID_GIGL_SHIPPING');
  });

  it('fails closed without quoting when the retention lookup fails', async () => {
    setup({ order: checkoutOrder('paystack') });
    retention.settled.mockRejectedValue(new Error('rls detail'));

    const response = await subject({ receiver, preview: true });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 'CHECKOUT_SHIPPING_PAYMENT_LOOKUP_FAILED',
      error:
        'Could not check what the customer paid for delivery. Please try again.',
    });
    expect(mocks.getProviderQuotes).not.toHaveBeenCalled();
  });
});
