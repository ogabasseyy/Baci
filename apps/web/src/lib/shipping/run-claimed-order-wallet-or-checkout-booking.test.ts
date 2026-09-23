import { beforeEach, describe, expect, it, vi } from 'vitest';

const getShippingQuoteBookingEconomics = vi.fn();
const bookWalletOrCustomerCheckout = vi.fn();
const bookOrderShipment = vi.fn();
const clearOrderShipmentBookingLock = vi.fn();
const refreshWalletOrderShipmentQuote = vi.fn();
const findReusableOrderShipment = vi.fn();

vi.mock('@/lib/shipping/shipping-quote-booking-economics', () => ({
  getShippingQuoteBookingEconomics,
}));
vi.mock('@/lib/shipping/book-wallet-or-customer-checkout', () => ({
  bookWalletOrCustomerCheckout,
}));
vi.mock('@/lib/shipping/book-order-shipment', () => ({
  bookOrderShipment,
}));
vi.mock('@/lib/shipping/order-shipment-booking-lock', () => ({
  clearOrderShipmentBookingLock,
}));
vi.mock('@/lib/shipping/refresh-wallet-order-shipment-quote', () => ({
  refreshWalletOrderShipmentQuote,
}));
vi.mock('@/lib/shipping/find-reusable-order-shipment', () => ({
  findReusableOrderShipment,
}));

const { runClaimedOrderWalletOrCheckoutBooking } = await import(
  './run-claimed-order-wallet-or-checkout-booking'
);

describe('runClaimedOrderWalletOrCheckoutBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads economics and dispatches wallet-or-checkout booking with payment override', async () => {
    getShippingQuoteBookingEconomics.mockResolvedValue({
      shipping_platform_retained_amount: 1500,
    });
    bookWalletOrCustomerCheckout.mockResolvedValue({
      provider: 'GIGL',
      quoteId: 'quote-1',
      shipmentId: 'ship-1',
      trackingNumber: 'TRK-1',
    });

    const supabase = { rpc: vi.fn() } as never;
    const result = await runClaimedOrderWalletOrCheckoutBooking(
      supabase,
      'merchant-1',
      'order-1',
      {
        selected_quote_id: 'quote-1',
        shipping_funding_source: 'customer_checkout',
        shipping_provider: 'GIGL',
        payment_status: 'unpaid',
        payment_method: 'paystack',
      },
      {
        paymentStatus: 'paid',
        lockToken: 'lock-1',
      }
    );

    expect(getShippingQuoteBookingEconomics).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1',
      'quote-1'
    );
    expect(bookWalletOrCustomerCheckout).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1',
      'quote-1',
      'customer_checkout',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      {
        shipping_provider: 'GIGL',
        payment_status: 'paid',
        payment_method: 'paystack',
        shipping_funding_source: 'customer_checkout',
        shipping_platform_retained_amount: 1500,
      }
    );
    expect(result).toEqual({
      provider: 'GIGL',
      quoteId: 'quote-1',
      shipmentId: 'ship-1',
      trackingNumber: 'TRK-1',
    });
  });

  it('skips economics lookup when the order has no selected quote', async () => {
    bookWalletOrCustomerCheckout.mockResolvedValue({
      provider: 'GIGL',
      quoteId: '',
      shipmentId: 'ship-2',
      trackingNumber: null,
    });

    await runClaimedOrderWalletOrCheckoutBooking(
      {} as never,
      'merchant-1',
      'order-1',
      {
        selected_quote_id: null,
        shipping_funding_source: null,
        shipping_provider: 'GIGL',
        payment_status: 'paid',
        payment_method: 'paystack',
      }
    );

    expect(getShippingQuoteBookingEconomics).not.toHaveBeenCalled();
    expect(bookWalletOrCustomerCheckout).toHaveBeenCalledWith(
      expect.anything(),
      'merchant-1',
      'order-1',
      '',
      null,
      expect.any(Function),
      undefined,
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({
        shipping_platform_retained_amount: null,
        payment_status: 'paid',
      })
    );
  });
});
