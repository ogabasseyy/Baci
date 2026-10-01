import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { validateSelectedAirportQuote } from './validate-selected-airport-quote';

const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174000';
const QUOTE_ID = '11111111-1111-4111-8111-111111111111';

const validQuote = {
  expires_at: '2099-01-01T00:00:00.000Z',
  price: 18_500,
  provider: 'GIGL',
  provider_rate_id: 'GIGL_30_0_1_0_1_4',
};

function mockSupabase(quote: unknown, replay = false): SupabaseClient {
  const rpc = vi.fn((name: string) => {
    if (name === 'get_checkout_shipping_quote') {
      return Promise.resolve({ data: quote, error: null });
    }
    return Promise.resolve({ data: replay, error: null });
  });

  return { rpc } as unknown as SupabaseClient;
}

describe('validateSelectedAirportQuote', () => {
  it('accepts an eligible quote at its stored price', async () => {
    await expect(
      validateSelectedAirportQuote({
        merchantId: MERCHANT_ID,
        selectedQuoteId: QUOTE_ID,
        shippingFee: 18_500,
        shippingProvider: 'GIGL',
        supabase: mockSupabase(validQuote),
      })
    ).resolves.toBe(false);
  });

  it('allows a confirmed replay when the quote was deleted', async () => {
    await expect(
      validateSelectedAirportQuote({
        merchantId: MERCHANT_ID,
        requestIdempotencyKey: 'airport-retry',
        selectedQuoteId: QUOTE_ID,
        shippingFee: 18_500,
        shippingProvider: 'GIGL',
        supabase: mockSupabase(null, true),
      })
    ).resolves.toBe(true);
  });

  it('rejects a non-airport quote', async () => {
    await expect(
      validateSelectedAirportQuote({
        merchantId: MERCHANT_ID,
        selectedQuoteId: QUOTE_ID,
        shippingFee: 18_500,
        shippingProvider: 'GIGL',
        supabase: mockSupabase({
          ...validQuote,
          provider_rate_id: 'GIGL_30_0_1_0_0_4',
        }),
      })
    ).rejects.toMatchObject({ code: 'AIRPORT_QUOTE_INVALID', status: 400 });
  });
});
