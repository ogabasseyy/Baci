import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { isSelectedAirportQuote } from '@/lib/checkout/is-selected-airport-quote';

const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174000';
const QUOTE_ID = '11111111-1111-4111-8111-111111111111';

function mockSupabase(data: unknown, error: unknown = null): SupabaseClient {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error }),
  } as unknown as SupabaseClient;
}

describe('isSelectedAirportQuote', () => {
  it('classifies a stored GIGL GoFaster home-delivery quote as airport eligible', async () => {
    const result = await isSelectedAirportQuote({
      merchantId: MERCHANT_ID,
      selectedQuoteId: QUOTE_ID,
      supabase: mockSupabase([
        {
          provider: 'GIGL',
          provider_rate_id: 'GIGL_30_0_1_0_1_4',
          service_tier: 'GoFaster',
        },
      ]),
    });

    expect(result).toBe(true);
  });

  it('returns false when no quote is selected', async () => {
    const result = await isSelectedAirportQuote({
      merchantId: MERCHANT_ID,
      selectedQuoteId: null,
      supabase: mockSupabase(null),
    });

    expect(result).toBe(false);
  });
});
