import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { quoteProviderFailure } from '@/lib/shipping/quote-provider-failure';
import {
  catalogToken,
  input,
  merchantId,
  mocks,
  POST,
  quoteId,
  request,
} from './route.test-support';

describe('partner delivery quotes', () => {
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
          stockByListing: new Map([['listing-one', 10]]),
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
    using warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.stubEnv('CROSSREM_SETTLEMENT_BASIS', undefined);
    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: 'QUOTE_SETTLEMENT_UNAVAILABLE' },
    });
    expect(warn).toHaveBeenCalledWith({
      message: 'Partner quote settlement policy is unconfigured',
      connectionId: 'crossrem-ogabassey',
      requestId: expect.any(String),
    });
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.rates).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a quantity above inventory before contacting the carrier', async () => {
    mocks.catalog.mockImplementationOnce(
      (stockByListing?: Map<string, number>) => {
        stockByListing?.set('listing-one', 1);
        return {
          listings: [
            {
              listing_id: 'listing-one',
              availability: 'in_stock',
              product_id: 'product-one',
              variant_id: 'variant-one',
              offer_id: null,
              title: 'Device',
              condition: 'new',
              price_minor: 10600,
              base_price_minor: 10000,
            },
          ],
        };
      }
    );

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'LISTING_UNAVAILABLE' },
    });
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

  it('does not issue a zero-fee rate that the merchant wallet cannot bind', async () => {
    mocks.rates.mockResolvedValueOnce([
      {
        id: quoteId,
        provider: 'GIGL',
        currency: 'NGN',
        providerRateId: 'zero-fee',
        price: 0,
        providerCost: 0,
        serviceTier: 'Standard',
        expiresAt: new Date('2026-11-20T14:04:00.000Z'),
      },
    ]);

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: 'CARRIER_UNAVAILABLE' },
    });
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
