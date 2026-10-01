import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDomesticRequest,
  GIGL_QUOTE_ID,
  giglQuote,
  indiaRatesPayload,
  indiaReceiver,
  lagosRatesPayload,
  mockCreateAdminClient,
  mockCreateServerClient,
  mockGetQuotes,
  RATE_ID,
} from './route.merchant-rates.test-fixtures';

// R14-1: on the BODY-ONLY path (root-domain slug checkout — merchantId in the
// body, no trusted x-merchant-slug header and no authenticated session) the
// route cannot read the merchants table, so the SECURITY DEFINER RPC is the
// ONLY currency-discovery path. The merchant-rate load must therefore run even
// for a client that CANNOT handle merchant rates
// (`supports_merchant_rates: false`), so the NGN-only carriers are suppressed
// for a non-NG merchant. The unbookable mrate_ quotes are still withheld from
// the incapable client.
const BODY_MERCHANT_ID = '99999999-9999-4999-8999-999999999999';

const indiaRatesPayloadWithCurrency = {
  ...indiaRatesPayload,
  merchant_payout_currency: 'INR',
  merchant_country: 'IN',
};

function buildBodyOnlySupabaseMock(ratesPayload: unknown) {
  const shippingQuotesTable = {
    upsert: vi.fn().mockResolvedValue({ error: null }),
  };

  return {
    // No authenticated user: the merchant is resolved from the body id only, so
    // there is no trusted currency/country context.
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: null },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'shipping_quotes') {
        return shippingQuotesTable;
      }
      // Anti-enumeration boundary: a body-only request must NEVER read the
      // merchants table. Currency is discovered through the definer RPC.
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn((name: string) => {
      if (name === 'get_storefront_shipping_sender') {
        const nonNgMerchant =
          typeof ratesPayload === 'object' &&
          ratesPayload !== null &&
          'merchant_country' in ratesPayload &&
          ratesPayload.merchant_country === 'IN';
        return Promise.resolve({
          data: {
            business_address: nonNgMerchant
              ? '1 Market Road, Bengaluru'
              : '1 Allen Avenue, Ikeja, Lagos',
            business_name: 'Merchant Store',
            country: nonNgMerchant ? 'IN' : 'NG',
            phone: nonNgMerchant ? '+919876543210' : '+2348012345678',
            state_code: nonNgMerchant ? null : 'LA',
          },
          error: null,
        });
      }
      if (name === 'get_storefront_shipping_rates') {
        return Promise.resolve({ data: ratesPayload, error: null });
      }
      throw new Error(`Unexpected RPC: ${name}`);
    }),
    shippingQuotesTable,
  };
}

async function postBodyOnlyQuotes(
  ratesPayload: unknown,
  overrides: Record<string, unknown> = {}
) {
  const supabase = buildBodyOnlySupabaseMock(ratesPayload);
  mockCreateAdminClient.mockReturnValue(supabase);
  mockCreateServerClient.mockResolvedValue(supabase);
  const { POST } = await import('./route');

  const request = buildDomesticRequest({
    merchantId: BODY_MERCHANT_ID,
    ...overrides,
  });
  request.headers.set('x-baci-client', 'mobile-storefront');
  const response = await POST(request);
  return { json: await response.json(), response, supabase };
}

describe('POST /api/shipping/quotes body-only merchant-currency discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetQuotes.mockResolvedValue({
      quotes: { featured: [giglQuote], all: [giglQuote] },
      sessionId: 'session-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
  });

  it('suppresses NGN carriers for a body-only non-supporting client once the RPC reveals a non-NG merchant', async () => {
    // supports_merchant_rates absent: the RPC still runs (currency discovery),
    // reveals an IN/INR merchant, so the Nigerian NGN carrier quotes are
    // dropped and the unbookable mrate_ quotes are withheld from the incapable
    // client — leaving the empty + unavailable-warning response.
    const { json, response } = await postBodyOnlyQuotes(
      indiaRatesPayloadWithCurrency,
      { receiver: indiaReceiver }
    );

    expect(response.status).toBe(200);
    expect(json.quotes).toEqual({ featured: [], all: [] });
    // No leaked Nigerian carrier quote.
    expect(
      json.quotes.all.some(
        (quote: { provider: string }) => quote.provider === 'GIGL'
      )
    ).toBe(false);
    // No unbookable merchant-rate quote for the incapable client.
    expect(
      json.quotes.all.some((quote: { id: string }) =>
        quote.id.startsWith('mrate_')
      )
    ).toBe(false);
    expect(
      json.warnings.some((warning: string) =>
        /Nigerian merchants only/i.test(warning)
      )
    ).toBe(true);
  });

  it('exposes merchant-only rates for a body-only supporting client on a non-NG merchant', async () => {
    // supports_merchant_rates true: currency discovery reveals IN/INR, carriers
    // are suppressed, and the opted-in caller receives the bookable mrate_
    // quote.
    const { json, response } = await postBodyOnlyQuotes(
      indiaRatesPayloadWithCurrency,
      { receiver: indiaReceiver, supports_merchant_rates: true }
    );

    expect(response.status).toBe(200);
    expect(json.quotes.all).toEqual([
      expect.objectContaining({
        currency: 'INR',
        id: `mrate_${RATE_ID}`,
        price: 200,
        provider: 'MERCHANT',
      }),
    ]);
    expect(
      json.quotes.all.some(
        (quote: { provider: string }) => quote.provider === 'GIGL'
      )
    ).toBe(false);
    expect(json.warnings).toBeUndefined();
  });

  it('keeps carrier quotes for a body-only non-supporting client on an NG merchant', async () => {
    // The RPC returns an NG payload with no currency columns, so nothing new is
    // revealed and the NG carrier merge path stays byte-identical: carriers are
    // returned and no mrate_ quotes leak.
    const { json, response } = await postBodyOnlyQuotes(lagosRatesPayload);

    expect(response.status).toBe(200);
    expect(mockGetQuotes).toHaveBeenCalled();
    expect(json.quotes.all).toEqual([
      expect.objectContaining({ id: GIGL_QUOTE_ID, provider: 'GIGL' }),
    ]);
    expect(
      json.quotes.all.some((quote: { id: string }) =>
        quote.id.startsWith('mrate_')
      )
    ).toBe(false);
    expect(json.warnings).toBeUndefined();
  });
});
