import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_RATES_PAYLOAD,
  giglQuote,
  lagosRatesPayload,
  mockGetMerchantForApiRequest,
  mockGetQuotes,
  NG_MERCHANT,
  postQuotes,
  RATE_ID,
} from './route.merchant-rates.test-fixtures';

describe('manual address merchant-only quotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMerchantForApiRequest.mockResolvedValue({
      businessName: 'Merchant Store',
      merchantId: 'merchant-1',
    });
    mockGetQuotes.mockResolvedValue({
      quotes: { featured: [giglQuote], all: [giglQuote] },
      sessionId: 'session-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
  });

  it('returns configured merchant rates without contacting carriers or persisting a carrier quote', async () => {
    const { response, json, supabase } = await postQuotes(
      NG_MERCHANT,
      lagosRatesPayload,
      { supports_merchant_rates: true, merchant_rates_only: true }
    );
    expect(response.status).toBe(200);
    expect(mockGetQuotes).not.toHaveBeenCalled();
    expect(json.quotes.all).toEqual([
      expect.objectContaining({
        id: `mrate_${RATE_ID}`,
        provider: 'MERCHANT',
        price: 1500,
      }),
    ]);
    expect(supabase.shippingQuotesTable.upsert).not.toHaveBeenCalled();
  });

  it('does not fall back to carriers when no merchant rates match', async () => {
    const { response, json } = await postQuotes(
      NG_MERCHANT,
      EMPTY_RATES_PAYLOAD,
      { supports_merchant_rates: true, merchant_rates_only: true }
    );
    expect(response.status).toBe(200);
    expect(mockGetQuotes).not.toHaveBeenCalled();
    expect(json.quotes.all).toEqual([]);
    expect(json.warnings?.[0]).toMatch(/store delivery or pickup/i);
    expect(json.warnings?.[0]).not.toMatch(/Nigerian merchants only/i);
  });

  it('retains the merchant-rate client capability requirement', async () => {
    const { response, json } = await postQuotes(
      NG_MERCHANT,
      lagosRatesPayload,
      { merchant_rates_only: true }
    );
    expect(response.status).toBe(200);
    expect(mockGetQuotes).not.toHaveBeenCalled();
    expect(json.quotes.all).toEqual([]);
  });

  it('rejects a non-boolean opt-out instead of silently enabling carriers', async () => {
    const { response } = await postQuotes(NG_MERCHANT, lagosRatesPayload, {
      supports_merchant_rates: true,
      merchant_rates_only: 'true',
    });
    expect(response.status).toBe(400);
    expect(mockGetQuotes).not.toHaveBeenCalled();
  });

  it('reports a retryable rate lookup failure without offering carriers', async () => {
    const { response, json } = await postQuotes(
      NG_MERCHANT,
      lagosRatesPayload,
      { supports_merchant_rates: true, merchant_rates_only: true },
      { rpcError: true }
    );
    expect(response.status).toBe(503);
    expect(json.error).toMatch(/could not be loaded.*retry/i);
    expect(mockGetQuotes).not.toHaveBeenCalled();
  });
});
