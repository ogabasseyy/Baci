import { afterEach, beforeEach, vi } from 'vitest';
import type { PartnerProfile } from '../partner-profile';

const mocks = vi.hoisted(() => ({
  additionalProfiles: vi.fn<() => readonly PartnerProfile[]>(),
  lookup: vi.fn(),
  merchant: vi.fn(),
  rpc: vi.fn(),
  catalog: vi.fn(),
  sender: vi.fn(),
  rates: vi.fn(),
  proof: vi.fn(),
  rateLimit: vi.fn(),
}));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq:
          table === 'merchants'
            ? () => ({ maybeSingle: mocks.merchant })
            : mocks.lookup,
      }),
    }),
    rpc: mocks.rpc,
  }),
}));
vi.mock('../partner-profiles', async (importOriginal) => {
  const original =
    (await importOriginal()) as typeof import('../partner-profiles');
  return {
    getPartnerProfiles: () => [
      ...original.getPartnerProfiles(),
      ...mocks.additionalProfiles(),
    ],
  };
});
vi.mock('../catalog/catalog-service', () => ({
  loadCrossRemCatalog: mocks.catalog,
}));
vi.mock('@/app/api/shipping/quotes/resolve-public-merchant-sender', () => ({
  resolvePublicMerchantSender: mocks.sender,
}));
vi.mock('@/lib/shipping', () => ({
  shippingService: { getProviderQuotes: mocks.rates },
}));
vi.mock('@/lib/shipping/shipping-quote-route-proof', () => ({
  createShippingQuoteRouteProof: mocks.proof,
}));
vi.mock('@/lib/tenant-rate-limit', () => ({
  checkTenantRateLimitDetailed: mocks.rateLimit,
}));

const quoteToken = 'synthetic-quotes-token-with-enough-entropy-for-tests';
const catalogToken = 'synthetic-catalog-token-with-enough-entropy-for-tests';
const input = {
  items: [{ listing_id: 'listing-one', quantity: 2 }],
  destination: {
    address_line1: '10 Example Street',
    city: 'Ikeja',
    state: 'Lagos',
    country_code: 'NG',
  },
};
const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const quoteId = '20000000-0000-4000-8000-000000000001';
const request = (body: unknown = input, token = quoteToken) =>
  new Request('https://example.test/api/partners/v1/quotes', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.additionalProfiles.mockReturnValue([]);
  vi.stubEnv('CROSSREM_CATALOG_TOKEN', catalogToken);
  vi.stubEnv('CROSSREM_QUOTE_TOKEN', quoteToken);
  vi.stubEnv('CROSSREM_SETTLEMENT_BASIS', 'base_plus_delivery');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-20T14:00:00Z'));
  mocks.rateLimit.mockResolvedValue({ verdict: 'allowed' });
  mocks.catalog.mockImplementation((stockByListing?: Map<string, number>) => {
    stockByListing?.set('listing-one', 2);
    return {
      listings: [
        {
          listing_id: 'listing-one',
          product_id: 'product-one',
          variant_id: 'variant-one',
          offer_id: null,
          title: 'Device',
          condition: 'new',
          availability: 'in_stock',
          price_minor: 10600,
          base_price_minor: 10000,
        },
      ],
    };
  });
  mocks.merchant.mockResolvedValue({
    data: { vat_registration_status: 'not_registered' },
    error: null,
  });
  mocks.lookup.mockReturnValue({
    in: vi.fn().mockResolvedValue({
      data: [
        {
          id: 'product-one',
          weight_value: 500,
          weight_unit: 'g',
          dimensions: null,
        },
      ],
      error: null,
    }),
  });
  mocks.sender.mockResolvedValue({
    ok: true,
    country: 'NG',
    sender: {
      city: 'Ikeja',
      state: 'Lagos',
      countryCode: 'NG',
      phone: '08011112222',
    },
  });
  mocks.rates.mockResolvedValue([
    {
      id: quoteId,
      provider: 'GIGL',
      currency: 'NGN',
      providerRateId: 'fixture-rate',
      price: 1500,
      providerCost: 1000,
      serviceTier: 'Standard',
      estimatedDays: 2,
      expiresAt: new Date('2026-11-20T14:04:00Z'),
    },
  ]);
  mocks.proof.mockReturnValue({ signature: 'fixture-proof' });
  mocks.rpc.mockResolvedValue({ data: quoteId, error: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const { POST } = await import('./route');

export { catalogToken, input, merchantId, mocks, POST, quoteId, request };
