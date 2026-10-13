import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { validateLocalAirportFeeMismatch } from './validate-local-airport-fee-mismatch';

const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174000';

function mockSupabase(replay = false): SupabaseClient {
  return {
    rpc: vi.fn().mockResolvedValue({ data: replay, error: null }),
  } as unknown as SupabaseClient;
}

describe('validateLocalAirportFeeMismatch', () => {
  it('does nothing when the submitted fee matches', async () => {
    await expect(
      validateLocalAirportFeeMismatch({
        isLegacyMobileAirportDelivery: false,
        localAirportShippingFee: 35_000,
        merchantId: MERCHANT_ID,
        shippingFee: 35_000,
        supabase: mockSupabase(),
      })
    ).resolves.toBe(false);
  });

  it('requires a refresh before repricing a stale legacy mobile request', async () => {
    await expect(
      validateLocalAirportFeeMismatch({
        isLegacyMobileAirportDelivery: true,
        localAirportShippingFee: 35_000,
        merchantId: MERCHANT_ID,
        shippingFee: 25_000,
        supabase: mockSupabase(),
      })
    ).rejects.toMatchObject({ code: 'AIRPORT_FEE_UPDATE_REQUIRED' });
  });

  it('preserves a confirmed replay at its original fee', async () => {
    await expect(
      validateLocalAirportFeeMismatch({
        isLegacyMobileAirportDelivery: true,
        localAirportShippingFee: 35_000,
        merchantId: MERCHANT_ID,
        requestIdempotencyKey: 'airport-retry-key',
        shippingFee: 25_000,
        supabase: mockSupabase(true),
      })
    ).resolves.toBe(true);
  });
});
