import { describe, expect, it, vi } from 'vitest';
import type {
  QuoteRequest,
  QuoteResponse,
  ShippingQuote,
} from '@/lib/shipping/types';
import { orchestrateQuoteSources } from './quote-source-orchestration';

const quoteRequest: QuoteRequest = {
  merchantId: 'merchant-1',
  receiver: {
    name: 'Receiver',
    phone: '',
    address: '1 Lagos Street',
    city: 'Lagos',
    state: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
  },
  items: [{ name: 'Item', quantity: 1, weight: 1, value: 100 }],
  sessionId: 'session-1',
  shipmentType: 'domestic',
};

const carrierQuote: ShippingQuote = {
  id: '33333333-3333-4333-8333-333333333333',
  provider: 'GIGL',
  serviceTier: 'Standard',
  carrierName: 'GIG Logistics',
  displayName: 'GIG Logistics',
  estimatedDays: 3,
  price: 5000,
  currency: 'NGN',
  pickupIncluded: true,
  insuranceIncluded: true,
  expiresAt: new Date('2026-09-03T12:00:00.000Z'),
};

const carrierResponse: QuoteResponse = {
  quotes: { featured: [carrierQuote], all: [carrierQuote] },
  sessionId: 'session-1',
  expiresAt: '2026-09-03T12:00:00.000Z',
};

const baseInput = {
  quoteRequest,
  merchantCurrency: 'NGN',
  merchantCountry: 'NG',
  hasTrustedMerchantCurrencyContext: true,
  includeMerchantRateQuotes: false,
  sessionId: 'session-1',
};

describe('quote source orchestration', () => {
  it('passes a successful merchant provider allowlist through unchanged', async () => {
    const getCarrierQuotes = vi.fn().mockResolvedValue(carrierResponse);

    await orchestrateQuoteSources({
      ...baseInput,
      merchantRateResult: { quotes: [], enabledProviderCodes: ['GIGL'] },
      getCarrierQuotes,
    });

    expect(getCarrierQuotes).toHaveBeenCalledWith(quoteRequest, ['GIGL']);
  });

  it('passes an empty allowlist after a trusted merchant-rate RPC failure', async () => {
    const getCarrierQuotes = vi.fn().mockResolvedValue({
      quotes: { featured: [], all: [] },
      sessionId: 'session-1',
      expiresAt: '2026-09-03T12:00:00.000Z',
    });

    const response = await orchestrateQuoteSources({
      ...baseInput,
      merchantRateResult: { quotes: [], loadFailed: true },
      getCarrierQuotes,
    });

    expect(getCarrierQuotes).toHaveBeenCalledWith(quoteRequest, []);
    expect(response.quotes.all).toEqual([]);
  });

  it('fails closed when a successful RPC has no provider allowlist projection', async () => {
    const getCarrierQuotes = vi.fn().mockResolvedValue({
      quotes: { featured: [], all: [] },
      sessionId: 'session-1',
      expiresAt: '2026-09-03T12:00:00.000Z',
    });

    await orchestrateQuoteSources({
      ...baseInput,
      merchantRateResult: { quotes: [] },
      getCarrierQuotes,
    });

    expect(getCarrierQuotes).toHaveBeenCalledWith(quoteRequest, []);
  });

  it('keeps the default carriers for merchantless requests without an allowlist', async () => {
    const getCarrierQuotes = vi.fn().mockResolvedValue(carrierResponse);
    const merchantlessRequest = { ...quoteRequest, merchantId: undefined };

    await orchestrateQuoteSources({
      ...baseInput,
      quoteRequest: merchantlessRequest,
      merchantRateResult: { quotes: [] },
      getCarrierQuotes,
    });

    expect(getCarrierQuotes).toHaveBeenCalledWith(merchantlessRequest, [
      'GIGL',
      'TOPSHIP',
    ]);
  });

  it('returns the merchant-only unavailable response on a body-only load failure', async () => {
    const getCarrierQuotes = vi.fn();

    const response = await orchestrateQuoteSources({
      ...baseInput,
      hasTrustedMerchantCurrencyContext: false,
      merchantRateResult: { quotes: [], loadFailed: true },
      getCarrierQuotes,
    });

    expect(getCarrierQuotes).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      quotes: { featured: [], all: [] },
      sessionId: 'session-1',
    });
    expect(response.warnings?.[0]).toMatch(/Nigerian merchants only/i);
  });
});
