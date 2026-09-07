import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderShipmentBookingError } from '@/lib/shipping/order-shipment-booking-utils';
import {
  giglQuoteEconomicsFields,
  prepaidGiglCustomerCheckoutOrderFields,
} from './route.test-fixtures';

const {
  mockGetShippingQuoteBookingMetadata,
  mockGetShippingQuoteBookingEconomics,
  mockResolveBookingQuoteRequestPayload,
  mockValidateBookingQuoteRequestPayload,
} = vi.hoisted(() => ({
  mockGetShippingQuoteBookingMetadata: vi.fn(),
  mockGetShippingQuoteBookingEconomics: vi.fn(),
  mockResolveBookingQuoteRequestPayload: vi.fn(),
  mockValidateBookingQuoteRequestPayload: vi.fn(),
}));

vi.mock('@/lib/shipping/shipping-quote-booking-metadata', () => ({
  getShippingQuoteBookingMetadata: mockGetShippingQuoteBookingMetadata,
}));

vi.mock('@/lib/shipping/shipping-quote-booking-economics', () => ({
  getShippingQuoteBookingEconomics: mockGetShippingQuoteBookingEconomics,
  applyShippingQuoteBookingEconomicsToQuote: (
    quote: Record<string, unknown>,
    economics: Record<string, unknown> | null
  ) => (economics ? { ...quote, ...economics } : quote),
  applyShippingQuoteBookingEconomicsToOrder: (
    order: Record<string, unknown>,
    economics: Record<string, unknown> | null
  ) => (economics ? { ...order, ...economics } : order),
}));

vi.mock('./quote-request-payload', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./quote-request-payload')>();
  return {
    ...actual,
    resolveBookingQuoteRequestPayload: mockResolveBookingQuoteRequestPayload,
    validateBookingQuoteRequestPayload: mockValidateBookingQuoteRequestPayload,
  };
});

const orderId = '11111111-1111-4111-8111-111111111111';
const quoteId = '22222222-2222-4222-8222-222222222222';
const merchantId = 'merchant-1';

const bookingRequest = {
  orderId,
  quoteId,
  receiver: {
    name: 'Jane Customer',
    phone: '+2348022222222',
    address: '2 Customer Road',
    city: 'Lagos',
    state: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
  },
  items: [{ name: 'Phone', quantity: 1, weight: 1, value: 500000 }],
};

function buildSupabaseMock(orderOverrides: Record<string, unknown> = {}) {
  const order = {
    id: orderId,
    merchant_id: merchantId,
    selected_quote_id: quoteId,
    shipping_status: 'pending',
    shipping_fee: 4500,
    shipping_address: null,
    order_items: [{ name: 'Phone', quantity: 1, price: 500000 }],
    ...prepaidGiglCustomerCheckoutOrderFields,
    ...orderOverrides,
  };
  const quote = {
    id: quoteId,
    merchant_id: merchantId,
    provider: 'GIGL',
    service_tier: 'GoStandard',
    carrier_name: 'GIG Logistics',
    provider_rate_id: 'GIGL_RATE_1',
    quote_request: null,
    expires_at: '2099-01-01T00:00:00.000Z',
    price: 4500,
    currency: 'NGN',
    estimated_days: 2,
    ...giglQuoteEconomicsFields,
  };

  return {
    from: vi.fn((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: order, error: null }),
          })),
        };
      }
      if (table === 'shipping_quotes') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: quote, error: null }),
          })),
        };
      }
      if (table === 'merchant_settlements') {
        const eqSourceId = vi.fn().mockResolvedValue({
          data: [
            {
              metadata: { retained_shipping_amount: 4500 },
              status: 'completed',
            },
          ],
          error: null,
        });
        const eqSourceType = vi.fn(() => ({ eq: eqSourceId }));
        const eqMerchant = vi.fn(() => ({ eq: eqSourceType }));
        return {
          select: vi.fn(() => ({ eq: eqMerchant })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  } as unknown as SupabaseClient;
}

describe('loadDirectBookingContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetShippingQuoteBookingMetadata.mockResolvedValue(null);
    mockGetShippingQuoteBookingEconomics.mockResolvedValue({
      ...giglQuoteEconomicsFields,
      shipping_provider_cost: 3600,
      shipping_platform_margin: 900,
      shipping_pricing_version: 'gigl_platform_margin_v1',
      shipping_platform_retained_amount: 4500,
    });
    mockResolveBookingQuoteRequestPayload.mockReturnValue({
      items: bookingRequest.items,
      receiver: bookingRequest.receiver,
    });
    mockValidateBookingQuoteRequestPayload.mockReturnValue({ ok: true });
  });

  it('rejects unpaid pay-on-delivery GIGL customer checkout orders', async () => {
    const { loadDirectBookingContext } = await import(
      './load-direct-booking-context'
    );
    const supabase = buildSupabaseMock({
      payment_status: 'unpaid',
      payment_method: 'pay_on_delivery',
    });

    await expect(
      loadDirectBookingContext(supabase, merchantId, bookingRequest)
    ).rejects.toBeInstanceOf(OrderShipmentBookingError);
  });

  it('loads prepaid GIGL customer checkout orders', async () => {
    const { loadDirectBookingContext } = await import(
      './load-direct-booking-context'
    );
    const supabase = buildSupabaseMock();

    const result = await loadDirectBookingContext(
      supabase,
      merchantId,
      bookingRequest
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.order.payment_status).toBe('paid');
      expect(result.context.quote.provider).toBe('GIGL');
    }
  });
});
