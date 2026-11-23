import { beforeEach, describe, expect, it } from 'vitest';
import type { ShippingQuote } from '@/types/shipping-quote';
import {
  clearChatwootCarrierQuote,
  rememberChatwootCarrierQuote,
  resolveChatwootCarrierQuote,
} from './chatwoot-confirmed-carrier-quote';

const QUOTE = {
  id: 'quote-1',
  provider: 'GIGL',
  price: 4500,
} as unknown as ShippingQuote;

const ADDRESS = {
  address: '14 Admiralty Way, Lekki',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria' as const,
  countryCode: 'NG' as const,
  latitude: 6.4474,
  longitude: 3.4723,
};

describe('chatwoot-confirmed-carrier-quote', () => {
  beforeEach(() => {
    clearChatwootCarrierQuote();
  });

  it('remembers, resolves on exact scope, and rejects mismatched or expired scopes', () => {
    const entry = {
      id: 'q-1',
      cartKey: 'cart-1:2',
      merchantId: 'merchant-1',
      conversationId: 7,
      expiresAt: Date.now() + 60_000,
      quote: QUOTE,
      address: ADDRESS,
    };
    rememberChatwootCarrierQuote(entry);

    expect(
      resolveChatwootCarrierQuote({
        id: 'q-1',
        cartKey: 'cart-1:2',
        merchantId: 'merchant-1',
        conversationId: 7,
      })
    ).toEqual(entry);

    expect(
      resolveChatwootCarrierQuote({
        id: 'q-1',
        cartKey: 'cart-1:3',
        merchantId: 'merchant-1',
        conversationId: 7,
      })
    ).toBeNull();

    rememberChatwootCarrierQuote({ ...entry, expiresAt: Date.now() - 1 });
    expect(
      resolveChatwootCarrierQuote({
        id: 'q-1',
        cartKey: 'cart-1:2',
        merchantId: 'merchant-1',
        conversationId: 7,
      })
    ).toBeNull();
  });
});
