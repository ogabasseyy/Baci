import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_RATES_PAYLOAD,
  GIGL_QUOTE_ID,
  giglQuote,
  IN_MERCHANT,
  indiaRatesPayload,
  indiaReceiver,
  indiaReceiverOverride,
  indiaTieredRatesPayload,
  lagosRatesPayload,
  mockGetMerchantForApiRequest,
  mockGetQuotes,
  NG_MERCHANT,
  postQuotes,
  RATE_ID,
  TIER_RATE_ID,
} from './route.merchant-rates.test-fixtures';

describe('POST /api/shipping/quotes merchant-configured rates', () => {
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
  it('merges merchant rates with carrier quotes for an NG merchant and never persists them', async () => {
    const { json, response, supabase } = await postQuotes(
      NG_MERCHANT,
      lagosRatesPayload,
      { supports_merchant_rates: true }
    );

    expect(response.status).toBe(200);
    expect(mockGetQuotes).toHaveBeenCalled();
    expect(json.quotes.all).toHaveLength(2);
    expect(json.quotes.all).toContainEqual(
      expect.objectContaining({ id: GIGL_QUOTE_ID, provider: 'GIGL' })
    );
    expect(json.quotes.all).toContainEqual(
      expect.objectContaining({
        currency: 'NGN',
        id: `mrate_${RATE_ID}`,
        price: 1500,
        provider: 'MERCHANT',
      })
    );

    // Persistence: only the carrier quote row is upserted.
    expect(supabase.shippingQuotesTable.upsert).toHaveBeenCalledTimes(1);
    expect(supabase.shippingQuotesTable.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: GIGL_QUOTE_ID, provider: 'GIGL' }),
      { onConflict: 'id' }
    );
  });

  it('passes the merchant carrier allowlist to quote aggregation', async () => {
    const { response } = await postQuotes(NG_MERCHANT, {
      ...lagosRatesPayload,
      shipping_providers: ['gigl'],
    });

    expect(response.status).toBe(200);
    expect(mockGetQuotes).toHaveBeenCalledWith(expect.any(Object), ['GIGL']);
  });

  it('passes an explicit empty carrier allowlist without falling back to all providers', async () => {
    const { response } = await postQuotes(NG_MERCHANT, {
      ...EMPTY_RATES_PAYLOAD,
      shipping_providers: [],
    });

    expect(response.status).toBe(200);
    expect(mockGetQuotes).toHaveBeenCalledWith(expect.any(Object), []);
  });

  it('re-buckets featured picks after merging and never marks a 0-estimate merchant rate as fastest', async () => {
    const { json } = await postQuotes(NG_MERCHANT, lagosRatesPayload, {
      supports_merchant_rates: true,
    });

    // The merchant rate (no configured days => estimatedDays 0) wins cheapest.
    const economy = json.quotes.featured.find((quote: { id: string }) =>
      quote.id.startsWith('mrate_')
    );
    expect(economy).toMatchObject({ estimatedDays: 0, price: 1500 });

    // The fastest badge goes to the carrier quote, never the 0-day sentinel.
    const express = json.quotes.featured.find(
      (quote: { displayName: string }) =>
        quote.displayName.includes('Express Delivery')
    );
    expect(express).toMatchObject({ id: GIGL_QUOTE_ID, estimatedDays: 3 });
  });

  it('returns merchant-only quotes without warnings for an IN merchant with rates and never calls carriers', async () => {
    const { json, response, supabase } = await postQuotes(
      IN_MERCHANT,
      indiaRatesPayload,
      indiaReceiverOverride
    );

    expect(response.status).toBe(200);
    expect(mockGetQuotes).not.toHaveBeenCalled();
    expect(json.quotes.all).toEqual([
      expect.objectContaining({
        currency: 'INR',
        id: `mrate_${RATE_ID}`,
        price: 200,
        provider: 'MERCHANT',
      }),
    ]);
    expect(json.quotes.featured.length).toBeGreaterThan(0);
    expect(json.warnings).toBeUndefined();
    expect(supabase.shippingQuotesTable.upsert).not.toHaveBeenCalled();
  });

  it('returns empty quotes with the unavailable warning for an IN merchant with no configured rates', async () => {
    const { json, response } = await postQuotes(
      IN_MERCHANT,
      EMPTY_RATES_PAYLOAD,
      indiaReceiverOverride
    );

    expect(response.status).toBe(200);
    expect(mockGetQuotes).not.toHaveBeenCalled();
    expect(json.quotes).toEqual({ featured: [], all: [] });
    expect(
      json.warnings.some(
        (warning: string) =>
          /Nigerian merchants only/i.test(warning) &&
          /has not configured/i.test(warning)
      )
    ).toBe(true);
  });

  it('excludes price_tier rates and ignores free_over_amount when cart_subtotal is absent', async () => {
    const { json } = await postQuotes(
      IN_MERCHANT,
      indiaTieredRatesPayload,
      indiaReceiverOverride
    );

    expect(json.quotes.all).toHaveLength(1);
    expect(json.quotes.all[0]).toMatchObject({
      id: `mrate_${RATE_ID}`,
      price: 2000,
    });
  });

  it('includes an in-bounds price_tier rate when cart_subtotal is provided', async () => {
    const { json } = await postQuotes(IN_MERCHANT, indiaTieredRatesPayload, {
      ...indiaReceiverOverride,
      cart_subtotal: 10_000,
    });

    expect(json.quotes.all).toHaveLength(2);
    expect(json.quotes.all).toContainEqual(
      expect.objectContaining({ id: `mrate_${TIER_RATE_ID}`, price: 100 })
    );
    expect(json.quotes.all).toContainEqual(
      expect.objectContaining({ id: `mrate_${RATE_ID}`, price: 2000 })
    );
  });

  it('drops out-of-bounds price_tier rates and applies free_over_amount when cart_subtotal qualifies', async () => {
    const { json } = await postQuotes(IN_MERCHANT, indiaTieredRatesPayload, {
      ...indiaReceiverOverride,
      cart_subtotal: 60_000,
    });

    expect(json.quotes.all).toHaveLength(1);
    expect(json.quotes.all[0]).toMatchObject({
      id: `mrate_${RATE_ID}`,
      price: 0,
    });
  });

  it('keeps the carrier-only response identical when a capable NG merchant has no configured rates', async () => {
    const { json, supabase } = await postQuotes(
      NG_MERCHANT,
      EMPTY_RATES_PAYLOAD,
      { supports_merchant_rates: true }
    );

    expect(mockGetQuotes).toHaveBeenCalled();
    expect(json.quotes.all).toEqual([
      expect.objectContaining({ id: GIGL_QUOTE_ID, provider: 'GIGL' }),
    ]);
    expect(json.quotes.featured).toEqual([
      expect.objectContaining({ id: GIGL_QUOTE_ID }),
    ]);
    expect(json.warnings).toBeUndefined();
    expect(supabase.shippingQuotesTable.upsert).toHaveBeenCalledTimes(1);
  });

  it('excludes merchant rates but keeps carrier quotes for an NG merchant when supports_merchant_rates is absent', async () => {
    // No flag: the caller cannot thread mrate_ ids back into order creation, so
    // merchant rates must not appear even though the merchant configured them.
    const { json, response, supabase } = await postQuotes(
      NG_MERCHANT,
      lagosRatesPayload
    );

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
    expect(
      json.quotes.featured.some((quote: { id: string }) =>
        quote.id.startsWith('mrate_')
      )
    ).toBe(false);
    expect(json.warnings).toBeUndefined();
    // Byte-identical carrier-only persistence.
    expect(supabase.shippingQuotesTable.upsert).toHaveBeenCalledTimes(1);
  });

  it('excludes merchant rates for a non-NG merchant when supports_merchant_rates is absent', async () => {
    // Non-NG merchant with configured INR rates, but the caller did not opt in:
    // carriers are skipped (NGN-only) and merchant rates are gated off, so the
    // response falls through to the empty + unavailable-warning path.
    const { json, response } = await postQuotes(
      IN_MERCHANT,
      indiaRatesPayload,
      { receiver: indiaReceiver }
    );

    expect(response.status).toBe(200);
    expect(mockGetQuotes).not.toHaveBeenCalled();
    expect(json.quotes).toEqual({ featured: [], all: [] });
    expect(
      json.warnings.some((warning: string) =>
        /Nigerian merchants only/i.test(warning)
      )
    ).toBe(true);
  });

  it('fails closed with an empty provider allowlist for a trusted NG merchant when the merchant-rate RPC errors', async () => {
    mockGetQuotes.mockResolvedValue({
      quotes: { featured: [], all: [] },
      sessionId: 'session-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const { json, response, supabase } = await postQuotes(
      NG_MERCHANT,
      lagosRatesPayload,
      { supports_merchant_rates: true },
      { rpcError: true }
    );

    expect(response.status).toBe(200);
    expect(mockGetQuotes).toHaveBeenCalledWith(expect.any(Object), []);
    expect(json.quotes.all).toEqual([]);
    expect(json.quotes.featured).toEqual([]);
    expect(supabase.shippingQuotesTable.upsert).not.toHaveBeenCalled();
  });

  it('returns the empty + unavailable-rates response for a non-NG merchant when the merchant-rate RPC errors', async () => {
    // A non-NG merchant already skips the Nigerian carriers, so a failed rate
    // load leaves nothing to offer: the empty merchant-only response with the
    // unavailable warning, and carriers are never called.
    const { json, response } = await postQuotes(
      IN_MERCHANT,
      indiaRatesPayload,
      indiaReceiverOverride,
      { rpcError: true }
    );

    expect(response.status).toBe(200);
    expect(mockGetQuotes).not.toHaveBeenCalled();
    expect(json.quotes).toEqual({ featured: [], all: [] });
    expect(
      json.warnings.some(
        (warning: string) =>
          /Nigerian merchants only/i.test(warning) &&
          /has not configured/i.test(warning)
      )
    ).toBe(true);
  });
});
