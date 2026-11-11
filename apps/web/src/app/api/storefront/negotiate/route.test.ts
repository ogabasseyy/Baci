import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { callNegotiate, MERCHANT_ID, PRODUCT_ID } from './route.test-support';

vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({}) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

describe('POST /api/storefront/negotiate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a final best-price response for a budget brand and logs it', async () => {
    const { body, insert } = await callNegotiate(
      {
        id: PRODUCT_ID,
        name: 'Tecno Spark 50',
        brand: 'Tecno',
        price: 100000,
        cost_price: 80000,
        merchant_id: MERCHANT_ID,
      },
      90000
    );
    expect(body.status).toBe('final');
    expect(body.canContinue).toBe(false);
    // The non-negotiable short-circuit must still write negotiation_logs.
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'final' })
    );
  });

  it('returns a final best-price response for Samsung A-series', async () => {
    const { body } = await callNegotiate(
      {
        id: PRODUCT_ID,
        name: 'Samsung Galaxy A16 5G',
        brand: 'Samsung',
        price: 200000,
        cost_price: 150000,
        merchant_id: MERCHANT_ID,
      },
      180000
    );
    expect(body.status).toBe('final');
  });

  it('accepts a negotiable offer within 2%', async () => {
    const { body } = await callNegotiate(
      {
        id: PRODUCT_ID,
        name: 'MacBook Air M1',
        brand: 'Apple',
        price: 1000,
        cost_price: 600,
        merchant_id: MERCHANT_ID,
      },
      985
    );
    expect(body.status).toBe('accepted');
  });

  it('counters a negotiable offer beyond 2% no deeper than the 2% floor', async () => {
    const { body } = await callNegotiate(
      {
        id: PRODUCT_ID,
        name: 'MacBook Air M1',
        brand: 'Apple',
        price: 1000,
        cost_price: 600,
        merchant_id: MERCHANT_ID,
      },
      850
    );
    expect(body.status).toBe('counter');
    expect(body.counterOffer).toBeGreaterThanOrEqual(980); // ≥ 1000 * (1 - 0.02)
  });

  it('counters at the 1.5% tier on the second attempt', async () => {
    // attempt 2 tier = 1.5% → counter = max(floor 980, 1000 * 0.985 = 985) = 985.
    const { body } = await callNegotiate(
      {
        id: PRODUCT_ID,
        name: 'MacBook Air M1',
        brand: 'Apple',
        price: 1000,
        cost_price: 600,
        merchant_id: MERCHANT_ID,
      },
      850,
      2
    );
    expect(body.status).toBe('counter');
    expect(body.counterOffer).toBeGreaterThanOrEqual(985);
  });

  it('returns a final 2% offer on the third attempt', async () => {
    // attempt 3 → finalPrice = max(floor 980, 1000 * 0.98 = 980) = 980; offer
    // 850 < 980 → status 'final', counterOffer 980.
    const { body } = await callNegotiate(
      {
        id: PRODUCT_ID,
        name: 'MacBook Air M1',
        brand: 'Apple',
        price: 1000,
        cost_price: 600,
        merchant_id: MERCHANT_ID,
      },
      850,
      3
    );
    expect(body.status).toBe('final');
    expect(body.counterOffer).toBe(980);
  });

  it('accepts an offer at or above the original price', async () => {
    const { body } = await callNegotiate(
      {
        id: PRODUCT_ID,
        name: 'MacBook Air M1',
        brand: 'Apple',
        price: 1000,
        cost_price: 600,
        merchant_id: MERCHANT_ID,
      },
      1000
    );
    expect(body.status).toBe('accepted');
  });

  it('uses the 40% margin fallback when cost_price is null', async () => {
    // No cost_price → costPrice = 1000 * 0.6 = 600; minAcceptable =
    // max(600 * 1.1 = 660, 1000 * 0.98 = 980) = 980; offer 985 ≥ 980 → accepted.
    const { body } = await callNegotiate(
      {
        id: PRODUCT_ID,
        name: 'MacBook Air M1',
        brand: 'Apple',
        price: 1000,
        cost_price: null,
        merchant_id: MERCHANT_ID,
      },
      985
    );
    expect(body.status).toBe('accepted');
  });

  it('returns 404 when the product is not found', async () => {
    const { response, body } = await callNegotiate(null, 90000);
    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Product not found' });
  });

  it('returns 400 for an invalid productId UUID', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    vi.mocked(createClient).mockReturnValue({} as never);
    const request = new NextRequest(
      'http://localhost/api/storefront/negotiate',
      {
        method: 'POST',
        body: JSON.stringify({
          productId: 'invalid-uuid',
          merchantId: MERCHANT_ID,
          offeredPrice: 900,
        }),
      }
    );
    const response = await POST(request);
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request');
  });

  it('returns 400 for a non-positive offeredPrice', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    vi.mocked(createClient).mockReturnValue({} as never);
    const request = new NextRequest(
      'http://localhost/api/storefront/negotiate',
      {
        method: 'POST',
        body: JSON.stringify({
          productId: PRODUCT_ID,
          merchantId: MERCHANT_ID,
          offeredPrice: -50,
        }),
      }
    );
    const response = await POST(request);
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request');
  });
});

describe('currency-aware negotiation messages', () => {
  beforeEach(() => vi.clearAllMocks());

  const APPLE_PRODUCT = {
    id: PRODUCT_ID,
    name: 'MacBook Air M1',
    brand: 'Apple',
    price: 1000,
    cost_price: 600,
    merchant_id: MERCHANT_ID,
  };

  it('formats the accepted-offer message in NGN for an NGN merchant (unchanged baseline)', async () => {
    const { body } = await callNegotiate(APPLE_PRODUCT, 985, 1, {
      payout_currency: 'NGN',
      country: 'NG',
    });
    expect(body.status).toBe('accepted');
    expect(body.message).toBe('Great news! We can accept your offer of ₦985.');
  });

  it('formats the accepted-offer message in the merchant payout currency for an INR merchant', async () => {
    const { body } = await callNegotiate(APPLE_PRODUCT, 985, 1, {
      payout_currency: 'INR',
      country: 'IN',
    });
    expect(body.status).toBe('accepted');
    expect(body.message).toBe('Great news! We can accept your offer of ₹985.');
  });

  it('formats the counter-offer message in the merchant payout currency', async () => {
    const { body } = await callNegotiate(APPLE_PRODUCT, 850, 1, {
      payout_currency: 'INR',
      country: 'IN',
    });
    expect(body.status).toBe('counter');
    expect(body.message).toBe('We appreciate your offer! How about ₹990?');
  });

  it('formats the final best-price message in the merchant payout currency', async () => {
    const { body } = await callNegotiate(APPLE_PRODUCT, 850, 3, {
      payout_currency: 'INR',
      country: 'IN',
    });
    expect(body.status).toBe('final');
    expect(body.message).toBe(
      'This is our best price: ₹980. We cannot go lower.'
    );
  });

  it('falls back to NGN when the merchant row cannot be resolved', async () => {
    const { body } = await callNegotiate(APPLE_PRODUCT, 985, 1, null);
    expect(body.status).toBe('accepted');
    expect(body.message).toBe('Great news! We can accept your offer of ₦985.');
  });
});
