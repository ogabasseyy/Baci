import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShippingAddress } from './types';

const mocks = vi.hoisted(() => ({
  refreshOrderShipmentQuote: vi.fn(),
  resolveBookingMerchantSender: vi.fn(),
  getShippingQuoteBookingMetadata: vi.fn(),
  getShippingQuoteBookingEconomics: vi.fn(),
  hasActiveMerchantShippingCharge: vi.fn(),
}));

vi.mock('./refresh-order-shipment-quote', () => ({
  refreshOrderShipmentQuote: mocks.refreshOrderShipmentQuote,
}));
vi.mock('./resolve-booking-merchant-sender', () => ({
  resolveBookingMerchantSender: mocks.resolveBookingMerchantSender,
}));
vi.mock('./shipping-quote-booking-metadata', () => ({
  getShippingQuoteBookingMetadata: mocks.getShippingQuoteBookingMetadata,
}));
vi.mock('./shipping-quote-booking-economics', () => ({
  getShippingQuoteBookingEconomics: mocks.getShippingQuoteBookingEconomics,
  applyShippingQuoteBookingEconomicsToQuote: (
    quote: Record<string, unknown>,
    economics: Record<string, unknown> | null
  ) => (economics ? { ...quote, ...economics } : quote),
}));
vi.mock('./book-wallet-funded-reservation-cleanup', () => ({
  hasActiveMerchantShippingCharge: mocks.hasActiveMerchantShippingCharge,
}));

import { refreshWalletOrderShipmentQuote } from './refresh-wallet-order-shipment-quote';

const merchantId = 'merchant-1';
const orderId = 'order-1';
const quoteId = 'quote-1';
const merchantSender: ShippingAddress = {
  name: 'Registered Merchant Store',
  phone: '+2348012345678',
  address: '9 Registered Road, Ikeja, Lagos',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};
const destination = {
  address: '123 Main St',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};
const domesticQuoteRequest = {
  shipmentType: 'domestic' as const,
  sessionId: 'session-1',
  receiver: {
    name: 'Jane Doe',
    phone: '08012345678',
    ...destination,
  },
  items: [{ name: 'Widget', quantity: 1, weight: 1, value: 5000 }],
};
const storedQuote = {
  id: quoteId,
  merchant_id: merchantId,
  provider: 'GIGL',
  price: 2500,
  quote_request: domesticQuoteRequest,
};
const matchingOrder = {
  id: orderId,
  selected_quote_id: quoteId,
  shipping_provider: 'GIGL',
  shipping_address: destination,
  order_items: [{ name: 'Widget', quantity: 1, price: 5000 }],
};

function createSupabase(options?: {
  order?: { data: unknown; error: unknown };
  quote?: { data: unknown; error: unknown };
  updateError?: { message: string } | null;
  onOrderUpdate?: (payload: unknown) => void;
}) {
  const ordersSelectChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi
      .fn()
      .mockResolvedValue(
        options?.order ?? { data: matchingOrder, error: null }
      ),
  };
  const quotesSelectChain = {
    eq: vi.fn().mockReturnThis(),
    single: vi
      .fn()
      .mockResolvedValue(options?.quote ?? { data: storedQuote, error: null }),
  };
  const ordersUpdateChain = {
    error: options?.updateError ?? null,
    eq: vi.fn(),
  };
  ordersUpdateChain.eq.mockReturnValue(ordersUpdateChain);

  return {
    from: vi.fn((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn(() => ordersSelectChain),
          update: vi.fn((payload: unknown) => {
            options?.onOrderUpdate?.(payload);
            return ordersUpdateChain;
          }),
        };
      }
      if (table === 'shipping_quotes') {
        return { select: vi.fn(() => quotesSelectChain) };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  } as unknown as SupabaseClient;
}

function refresh(supabase = createSupabase()) {
  return refreshWalletOrderShipmentQuote(
    supabase,
    merchantId,
    orderId,
    quoteId
  );
}

describe('refreshWalletOrderShipmentQuote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getShippingQuoteBookingMetadata.mockResolvedValue({
      pricingTier: 'Premium',
    });
    mocks.getShippingQuoteBookingEconomics.mockResolvedValue({
      pricing_version: 'gigl_platform_margin_v1',
    });
    mocks.resolveBookingMerchantSender.mockResolvedValue({
      ok: true,
      sender: merchantSender,
    });
    mocks.refreshOrderShipmentQuote.mockResolvedValue({
      ...storedQuote,
      id: quoteId,
    });
    mocks.hasActiveMerchantShippingCharge.mockResolvedValue(false);
  });

  it.each([
    {
      name: 'the order is missing',
      options: { order: { data: null, error: { message: 'not found' } } },
      status: 404,
      code: 'ORDER_NOT_FOUND',
    },
    {
      name: 'the saved quote is not selected',
      options: {
        order: {
          data: { ...matchingOrder, selected_quote_id: 'quote-other' },
          error: null,
        },
      },
      status: 409,
      code: 'QUOTE_ORDER_MISMATCH',
    },
    {
      name: 'the order is not carrier-backed',
      options: {
        order: {
          data: { ...matchingOrder, shipping_provider: 'MERCHANT' },
          error: null,
        },
      },
      status: 400,
      code: 'INVALID_SHIPPING_PROVIDER',
    },
    {
      name: 'the saved quote is missing',
      options: { quote: { data: null, error: { message: 'missing' } } },
      status: 404,
      code: 'QUOTE_NOT_FOUND',
    },
    {
      name: 'the stored quote request cannot be parsed',
      options: {
        quote: {
          data: { ...storedQuote, quote_request: { invalid: true } },
          error: null,
        },
      },
      status: 400,
      code: 'QUOTE_REFRESH_UNAVAILABLE',
    },
    {
      name: 'the quote destination no longer matches the order',
      options: {
        order: {
          data: {
            ...matchingOrder,
            shipping_address: { ...destination, address: '99 Other Street' },
          },
          error: null,
        },
      },
      status: 400,
      code: 'SHIPPING_QUOTE_RECEIVER_MISMATCH',
    },
    {
      name: 'the order items no longer match the attested quote',
      options: {
        order: {
          data: {
            ...matchingOrder,
            order_items: [{ name: 'Widget', quantity: 3, price: 5000 }],
          },
          error: null,
        },
      },
      status: 400,
      code: 'SHIPPING_QUOTE_ITEMS_MISMATCH',
    },
    {
      name: 'the order package dimensions no longer match the attested quote',
      options: {
        order: {
          data: {
            ...matchingOrder,
            order_items: [
              {
                name: 'Widget',
                quantity: 1,
                price: 5000,
                product: {
                  weight_value: 1,
                  weight_unit: 'kg',
                  dimensions: { length: 20, width: 15, height: 10, unit: 'cm' },
                },
              },
            ],
          },
          error: null,
        },
        quote: {
          data: {
            ...storedQuote,
            quote_request: {
              ...domesticQuoteRequest,
              items: [
                {
                  name: 'Widget',
                  quantity: 1,
                  weight: 1,
                  value: 5000,
                  length: 10,
                  width: 8,
                  height: 6,
                },
              ],
            },
          },
          error: null,
        },
      },
      status: 400,
      code: 'SHIPPING_QUOTE_ITEMS_MISMATCH',
    },
  ])('throws $code when $name', async ({ options, status, code }) => {
    await expect(refresh(createSupabase(options))).rejects.toMatchObject({
      status,
      code,
    });
  });

  it('throws MERCHANT_SENDER_REQUIRED when domestic origin cannot be resolved', async () => {
    mocks.resolveBookingMerchantSender.mockResolvedValue({
      ok: false,
      error: 'Merchant shipping origin is not configured',
      status: 400,
    });

    await expect(refresh()).rejects.toMatchObject({
      status: 400,
      code: 'MERCHANT_SENDER_REQUIRED',
      message: 'Merchant shipping origin is not configured',
    });
    expect(mocks.refreshOrderShipmentQuote).not.toHaveBeenCalled();
  });

  it('skips merchant sender lookup for international quotes', async () => {
    await refresh(
      createSupabase({
        quote: {
          data: {
            ...storedQuote,
            quote_request: {
              ...domesticQuoteRequest,
              shipmentType: 'international',
            },
          },
          error: null,
        },
      })
    );

    expect(mocks.resolveBookingMerchantSender).not.toHaveBeenCalled();
    expect(mocks.refreshOrderShipmentQuote).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: quoteId }),
      'GIGL',
      undefined,
      { orderId }
    );
  });

  it('returns the same quote id when refresh does not persist a new quote', async () => {
    const updates: unknown[] = [];
    const supabase = createSupabase({
      onOrderUpdate: (payload) => updates.push(payload),
    });

    await expect(refresh(supabase)).resolves.toBe(quoteId);
    expect(mocks.refreshOrderShipmentQuote).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        id: quoteId,
        provider_metadata: { pricingTier: 'Premium' },
      }),
      'GIGL',
      merchantSender,
      { orderId }
    );
    expect(updates).toEqual([]);
  });

  it('attaches a replacement quote then requires explicit reconfirmation without changing the customer shipping fee', async () => {
    mocks.refreshOrderShipmentQuote.mockResolvedValue({
      ...storedQuote,
      id: 'quote-refreshed',
      price: 3200,
    });
    const updates: unknown[] = [];

    await expect(
      refresh(
        createSupabase({ onOrderUpdate: (payload) => updates.push(payload) })
      )
    ).rejects.toMatchObject({
      status: 409,
      code: 'MERCHANT_WALLET_QUOTE_RECONFIRM_REQUIRED',
    });
    expect(updates).toEqual([{ selected_quote_id: 'quote-refreshed' }]);
  });

  it('bugfix: skips quote refresh when an active wallet charge already holds funds', async () => {
    mocks.refreshOrderShipmentQuote.mockResolvedValue({
      ...storedQuote,
      id: 'quote-refreshed',
      price: 3200,
    });
    mocks.hasActiveMerchantShippingCharge.mockResolvedValue(true);
    const updates: unknown[] = [];

    await expect(
      refresh(
        createSupabase({ onOrderUpdate: (payload) => updates.push(payload) })
      )
    ).resolves.toBe(quoteId);
    expect(mocks.refreshOrderShipmentQuote).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(mocks.hasActiveMerchantShippingCharge).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      quoteId
    );
  });

  it('throws QUOTE_REFRESH_ORDER_UPDATE_FAILED when the order cannot be updated', async () => {
    mocks.refreshOrderShipmentQuote.mockResolvedValue({
      ...storedQuote,
      id: 'quote-refreshed',
      price: 3200,
    });

    await expect(
      refresh(createSupabase({ updateError: { message: 'write failed' } }))
    ).rejects.toMatchObject({
      status: 500,
      code: 'QUOTE_REFRESH_ORDER_UPDATE_FAILED',
    });
  });
});
