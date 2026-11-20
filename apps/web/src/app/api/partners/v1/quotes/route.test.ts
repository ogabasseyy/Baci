import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { quoteProviderFailure } from '@/lib/shipping/quote-provider-failure';
import type { PartnerProfile } from '../partner-profile';
import { POST } from './route';

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

describe('partner delivery quotes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.additionalProfiles.mockReturnValue([]);
    vi.stubEnv('CROSSREM_CATALOG_TOKEN', catalogToken);
    vi.stubEnv('CROSSREM_QUOTE_TOKEN', quoteToken);
    vi.stubEnv('CROSSREM_SETTLEMENT_BASIS', 'base_plus_delivery');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T14:00:00Z'));
    mocks.rateLimit.mockResolvedValue({ verdict: 'allowed' });
    mocks.catalog.mockResolvedValue({
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
      sender: { city: 'Ikeja', state: 'Lagos', countryCode: 'NG' },
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

  it('rejects oversized bodies before doing any partner work', async () => {
    const response = await POST(request('x'.repeat(8193)));
    expect(response.status).toBe(413);
    expect(mocks.catalog).not.toHaveBeenCalled();
  });

  it('accepts the request example published in the partner quickstart', async () => {
    const guide = readFileSync(
      new URL(
        '../../../../../../../../docs/partners/delivery-api-quickstart.md',
        import.meta.url
      ),
      'utf8'
    );
    const examples = guide
      .split('```')
      .filter((block) => block.startsWith('json'));
    const example = JSON.parse(examples[0].slice(4).trim());
    expect((await POST(request(example))).status).toBe(201);
  });

  it('quotes merchant-owned items and persists the exact carrier and amount before replying', async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      quote_id: quoteId,
      subtotal_minor: 21200,
      delivery_minor: 150000,
      total_minor: 171200,
      expires_at: '2026-11-20T14:04:00.000Z',
      stock_reserved: false,
    });
    expect(mocks.lookup).toHaveBeenCalledWith('merchant_id', merchantId);
    expect(mocks.rates).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        merchantId,
        deliveryPreference: 'door',
        items: [
          expect.objectContaining({
            name: 'Device',
            value: 100,
            quantity: 2,
            weight: 0.5,
          }),
        ],
      })
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      'persist_partner_delivery_quote',
      expect.objectContaining({
        p_quote_id: quoteId,
        p_merchant_id: merchantId,
        p_connection_id: 'crossrem-ogabassey',
        p_snapshot: expect.objectContaining({
          carrier_quote: expect.objectContaining({
            provider_rate_id: 'fixture-rate',
            provider_cost: 1000,
          }),
        }),
      })
    );
  });

  it('uses the second merchant profile for listing price, quote lifetime and writes', async () => {
    const otherMerchant = '60000000-0000-4000-8000-000000000002';
    const otherToken = 'another-merchant-quote-token-synthetic-test-01';
    mocks.additionalProfiles.mockReturnValue([
      {
        id: 'second-connection',
        merchantId: otherMerchant,
        credentials: [{ token: otherToken, scopes: ['quotes:write'] }],
        loadCatalog: async () => ({
          listings: [
            {
              listing_id: 'listing-one',
              product_id: 'product-one',
              variant_id: null,
              offer_id: null,
              title: 'Fixture merchant device',
              condition: 'new',
              availability: 'in_stock',
              price_minor: 50000,
              base_price_minor: 50000,
            },
          ],
        }),
        readCatalogSnapshot: vi.fn(),
        delivery: {
          carrier: 'GIGL',
          validityMs: 60_000,
          settlementBasis: 'base_plus_delivery',
        },
      },
    ]);

    const response = await POST(request(input, otherToken));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      subtotal_minor: 100000,
      expires_at: '2026-11-20T14:01:00.000Z',
    });
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.lookup).toHaveBeenCalledWith('merchant_id', otherMerchant);
    expect(mocks.sender).toHaveBeenCalledWith(expect.anything(), otherMerchant);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'persist_partner_delivery_quote',
      expect.objectContaining({
        p_merchant_id: otherMerchant,
        p_connection_id: 'second-connection',
      })
    );
  });

  it('holds quoting until settlement terms are configured', async () => {
    vi.stubEnv('CROSSREM_SETTLEMENT_BASIS', undefined);
    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: 'QUOTE_UNAVAILABLE' },
    });
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.rates).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('snapshots the merchant payable for the configured settlement basis', async () => {
    vi.stubEnv('CROSSREM_SETTLEMENT_BASIS', 'base_plus_delivery');
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(await response.json()).not.toHaveProperty('merchant_payable_minor');
    expect(mocks.rpc).toHaveBeenCalledWith(
      'persist_partner_delivery_quote',
      expect.objectContaining({
        p_snapshot: expect.objectContaining({
          settlement_basis: 'base_plus_delivery',
          merchant_payable_minor: 170000,
        }),
      })
    );
  });

  it('includes VAT in both buyer total and merchant payable from the merchandise basis', async () => {
    vi.stubEnv('CROSSREM_SETTLEMENT_BASIS', 'base_plus_delivery');
    mocks.merchant.mockResolvedValue({
      data: { vat_registration_status: 'registered' },
      error: null,
    });
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      tax_minor: 1500,
      total_minor: 172700,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'persist_partner_delivery_quote',
      expect.objectContaining({
        p_snapshot: expect.objectContaining({
          merchant_payable_minor: 171500,
          tax_minor: 1500,
        }),
      })
    );
  });

  it('rejects read-only credentials and caller-selected merchants', async () => {
    expect((await POST(request(input, catalogToken))).status).toBe(403);
    expect(
      (await POST(request({ ...input, merchant_id: 'other-store' }))).status
    ).toBe(400);
    expect(mocks.rates).not.toHaveBeenCalled();
  });

  it('rejects unknown and duplicate listings before calling GIG', async () => {
    expect(
      (
        await POST(
          request({ ...input, items: [{ listing_id: 'retired', quantity: 1 }] })
        )
      ).status
    ).toBe(409);
    expect(
      (
        await POST(
          request({ ...input, items: [...input.items, ...input.items] })
        )
      ).status
    ).toBe(400);
    expect(mocks.rates).not.toHaveBeenCalled();
  });

  it('distinguishes unavailable carrier infrastructure from no available door quote', async () => {
    mocks.rates.mockResolvedValueOnce(
      quoteProviderFailure.mark([], new Error('outage'))
    );
    mocks.rates.mockResolvedValueOnce([]);
    expect((await POST(request())).status).toBe(503);
    expect((await POST(request())).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not publish a quote that was not durably stored', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
    expect((await POST(request())).status).toBe(503);
  });

  it('rejects an ambiguous credential configuration before any merchant work', async () => {
    vi.stubEnv('CROSSREM_QUOTE_TOKEN', catalogToken);
    expect((await POST(request(input, catalogToken))).status).toBe(401);
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
});
