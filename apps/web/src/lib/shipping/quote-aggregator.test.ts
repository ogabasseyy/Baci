import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ShippingProvider,
  ShippingProviderRegistry,
} from './providers/base';
import { QuoteAggregator } from './quote-aggregator';
import type { QuoteRequest } from './types';

const quoteRequest: QuoteRequest = {
  sessionId: 'session-agg-1',
  shipmentType: 'domestic',
  receiver: {
    name: 'Customer',
    phone: '+2348000000001',
    address: '1 Customer Street',
    city: 'Ikeja',
    state: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
  },
  items: [{ name: 'Phone', quantity: 1, weight: 1, value: 50_000 }],
} as QuoteRequest;

function createProvider(
  overrides: Partial<ShippingProvider> = {}
): ShippingProvider {
  return {
    code: 'GIGL',
    name: 'GIG Logistics',
    supportsDomestic: true,
    supportsInternational: false,
    getQuotes: vi.fn(() => Promise.resolve([])),
    ...overrides,
  } as unknown as ShippingProvider;
}

const successfulQuote = {
  id: 'gigl-quote-1',
  provider: 'GIGL' as const,
  serviceTier: 'Standard',
  carrierName: 'GIG Logistics',
  displayName: 'GIG Logistics',
  estimatedDays: 3,
  price: 5000,
  currency: 'NGN',
  pickupIncluded: true,
  insuranceIncluded: true,
  expiresAt: new Date(Date.now() + 60_000),
};

describe('QuoteAggregator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the provider quotes with no warnings on the happy path', async () => {
    const registry = new ShippingProviderRegistry();
    registry.register(
      createProvider({
        getQuotes: vi.fn(() => Promise.resolve([successfulQuote])),
      })
    );
    const aggregator = new QuoteAggregator(registry);

    const response = await aggregator.getQuotes(quoteRequest);

    expect(response.quotes.all).toHaveLength(1);
    expect(response.quotes.all[0].id).toBe('gigl-quote-1');
    expect(response.quotes.featured).toContainEqual(
      expect.objectContaining({ id: 'gigl-quote-1' })
    );
    expect(response.warnings).toBeUndefined();
  });

  it('returns an explicit warning when the registry has no quote providers', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const aggregator = new QuoteAggregator(new ShippingProviderRegistry());

    const response = await aggregator.getQuotes(quoteRequest);

    expect(response.quotes.all).toHaveLength(0);
    expect(response.warnings).toEqual([
      'No shipping providers are currently enabled',
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      '[QuoteAggregator] No providers registered for quotes',
      { shipmentType: 'domestic' }
    );
  });

  it('collects provider failures as warnings when a registered provider rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const registry = new ShippingProviderRegistry();
    registry.register(
      createProvider({
        getQuotes: vi.fn(() =>
          Promise.reject(new Error('upstream unavailable'))
        ),
      })
    );
    const aggregator = new QuoteAggregator(registry);

    const response = await aggregator.getQuotes(quoteRequest);

    expect(response.quotes.all).toHaveLength(0);
    expect(response.warnings).toEqual(['GIG Logistics: upstream unavailable']);
  });

  it('calls only providers enabled by the merchant', async () => {
    const giglGetQuotes = vi.fn(() => Promise.resolve([successfulQuote]));
    const topshipGetQuotes = vi.fn(() => Promise.resolve([]));
    const registry = new ShippingProviderRegistry();
    registry.register(createProvider({ getQuotes: giglGetQuotes }));
    registry.register(
      createProvider({
        code: 'TOPSHIP',
        name: 'Topship',
        getQuotes: topshipGetQuotes,
      })
    );
    const aggregator = new QuoteAggregator(registry);

    const response = await aggregator.getQuotes(quoteRequest, ['GIGL']);

    expect(giglGetQuotes).toHaveBeenCalledOnce();
    expect(topshipGetQuotes).not.toHaveBeenCalled();
    expect(response.quotes.all).toHaveLength(1);
  });

  it('does not call any carrier when the merchant disables every provider', async () => {
    const getQuotes = vi.fn(() => Promise.resolve([successfulQuote]));
    const registry = new ShippingProviderRegistry();
    registry.register(createProvider({ getQuotes }));
    const aggregator = new QuoteAggregator(registry);

    const response = await aggregator.getQuotes(quoteRequest, []);

    expect(getQuotes).not.toHaveBeenCalled();
    expect(response.quotes.all).toEqual([]);
    expect(response.warnings).toEqual([
      'No carrier shipping providers are enabled for this store',
    ]);
  });
});
