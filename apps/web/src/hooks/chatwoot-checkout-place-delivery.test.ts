import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/hooks/cart';
import type { ShippingQuote } from '@/types/shipping-quote';
import type { ChatwootCheckoutMerchant } from './chatwoot-checkout-merchant';
import {
  clearChatwootCarrierQuote,
  rememberChatwootCarrierQuote,
} from './chatwoot-confirmed-carrier-quote';

const resolveDeliveryMock = vi.hoisted(() => vi.fn());

vi.mock('./chatwoot-checkout-delivery', () => ({
  resolveChatwootCheckoutDelivery: resolveDeliveryMock,
}));

import { resolveChatwootPlaceDelivery } from './chatwoot-checkout-place-delivery';

const MERCHANT = {
  id: 'merchant-1',
  slug: 'ogabassey',
  businessName: 'Ogabassey',
  country: 'NG',
  currency: 'NGN',
} as unknown as ChatwootCheckoutMerchant;

const DISPLAY_ITEMS: CartItem[] = [
  {
    id: 'prod-1',
    name: 'iPhone 13',
    price: 385_000,
    quantity: 1,
  } as CartItem,
];

const CARRIER_QUOTE_ID = 'gigl-quote-123';

const SHIPPING_QUOTE = {
  id: 'quote-1',
  provider: 'GIGL',
  carrierName: 'GIG Logistics',
  displayName: 'GIG Logistics',
  price: 4500,
  currency: 'NGN',
  estimatedDays: 1,
} as unknown as ShippingQuote;

const CONFIRMED_ADDRESS = {
  address: '14 Admiralty Way, Lekki Phase 1',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria' as const,
  countryCode: 'NG' as const,
  latitude: 6.4474,
  longitude: 3.4723,
};

const BASE_REQUEST = {
  requestId: '550e8400-e29b-41d4-a716-446655440000',
  conversationId: 42,
  sessionToken: 'session-token',
  cartVersion: 3,
  customer: {
    firstName: 'Ada',
    lastName: 'Obi',
    email: 'ada@example.com',
    phone: '+2348012345678',
  },
  address: {
    line1: '14 Admiralty Way',
    city: 'Lekki',
    state: 'Lagos',
  },
  delivery: {
    displayName: 'Lagos Express',
    priceMajor: 3000,
    pickup: false,
  },
  paymentMethod: 'bank_transfer' as const,
};

describe('resolveChatwootPlaceDelivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearChatwootCarrierQuote();
  });

  it('resolves a remembered GIGL carrier quote and attaches customer phone', async () => {
    rememberChatwootCarrierQuote({
      id: CARRIER_QUOTE_ID,
      cartKey: 'cart-1:3',
      merchantId: 'merchant-1',
      conversationId: 42,
      expiresAt: Date.now() + 10 * 60_000,
      quote: SHIPPING_QUOTE,
      address: CONFIRMED_ADDRESS,
    });

    const result = await resolveChatwootPlaceDelivery({
      request: { ...BASE_REQUEST, carrierQuoteId: CARRIER_QUOTE_ID },
      authorizedCartId: 'cart-1',
      merchant: MERCHANT,
      display: DISPLAY_ITEMS,
      itemsSubtotalMinor: 38_500_000,
    });

    expect(result).toEqual({
      ok: true,
      method: 'door',
      carrier: 'GIGL',
      merchantRateId: null,
      quote: SHIPPING_QUOTE,
      address: {
        ...CONFIRMED_ADDRESS,
        phone: '+2348012345678',
      },
    });
    expect(resolveDeliveryMock).not.toHaveBeenCalled();
  });

  it('returns delivery_unavailable when carrierQuoteId is mismatched on cart, merchant, or conversation', async () => {
    rememberChatwootCarrierQuote({
      id: CARRIER_QUOTE_ID,
      cartKey: 'cart-1:3',
      merchantId: 'merchant-1',
      conversationId: 42,
      expiresAt: Date.now() + 10 * 60_000,
      quote: SHIPPING_QUOTE,
      address: CONFIRMED_ADDRESS,
    });

    const wrongCartVersion = await resolveChatwootPlaceDelivery({
      request: {
        ...BASE_REQUEST,
        cartVersion: 4,
        carrierQuoteId: CARRIER_QUOTE_ID,
      },
      authorizedCartId: 'cart-1',
      merchant: MERCHANT,
      display: DISPLAY_ITEMS,
      itemsSubtotalMinor: 38_500_000,
    });
    expect(wrongCartVersion).toEqual({
      ok: false,
      code: 'delivery_unavailable',
    });

    const wrongMerchant = await resolveChatwootPlaceDelivery({
      request: { ...BASE_REQUEST, carrierQuoteId: CARRIER_QUOTE_ID },
      authorizedCartId: 'cart-1',
      merchant: { ...MERCHANT, id: 'merchant-2' },
      display: DISPLAY_ITEMS,
      itemsSubtotalMinor: 38_500_000,
    });
    expect(wrongMerchant).toEqual({
      ok: false,
      code: 'delivery_unavailable',
    });

    const wrongConversation = await resolveChatwootPlaceDelivery({
      request: {
        ...BASE_REQUEST,
        conversationId: 99,
        carrierQuoteId: CARRIER_QUOTE_ID,
      },
      authorizedCartId: 'cart-1',
      merchant: MERCHANT,
      display: DISPLAY_ITEMS,
      itemsSubtotalMinor: 38_500_000,
    });
    expect(wrongConversation).toEqual({
      ok: false,
      code: 'delivery_unavailable',
    });
    expect(resolveDeliveryMock).not.toHaveBeenCalled();
  });

  it('returns delivery_unavailable when the remembered carrier quote has expired', async () => {
    rememberChatwootCarrierQuote({
      id: CARRIER_QUOTE_ID,
      cartKey: 'cart-1:3',
      merchantId: 'merchant-1',
      conversationId: 42,
      expiresAt: Date.now() - 1000,
      quote: SHIPPING_QUOTE,
      address: CONFIRMED_ADDRESS,
    });

    const result = await resolveChatwootPlaceDelivery({
      request: { ...BASE_REQUEST, carrierQuoteId: CARRIER_QUOTE_ID },
      authorizedCartId: 'cart-1',
      merchant: MERCHANT,
      display: DISPLAY_ITEMS,
      itemsSubtotalMinor: 38_500_000,
    });

    expect(result).toEqual({ ok: false, code: 'delivery_unavailable' });
    expect(resolveDeliveryMock).not.toHaveBeenCalled();
  });

  it('falls back to legacy merchant-rate delivery resolution when carrierQuoteId is omitted', async () => {
    const legacyResult = {
      ok: true as const,
      method: 'door' as const,
      quote: SHIPPING_QUOTE,
      carrier: 'merchant' as const,
      merchantRateId: 'rate-1',
      address: {
        ...CONFIRMED_ADDRESS,
        phone: '+2348012345678',
      },
    };
    resolveDeliveryMock.mockResolvedValueOnce(legacyResult);

    const result = await resolveChatwootPlaceDelivery({
      request: BASE_REQUEST,
      authorizedCartId: 'cart-1',
      merchant: MERCHANT,
      display: DISPLAY_ITEMS,
      itemsSubtotalMinor: 38_500_000,
    });

    expect(result).toEqual(legacyResult);
    expect(resolveDeliveryMock).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      customer: BASE_REQUEST.customer,
      address: BASE_REQUEST.address,
      choice: BASE_REQUEST.delivery,
      quoteItems: [
        {
          name: 'iPhone 13',
          quantity: 1,
          price: 385_000,
          negotiatedPrice: undefined,
        },
      ],
      cartSubtotal: 385_000,
    });
  });
});
