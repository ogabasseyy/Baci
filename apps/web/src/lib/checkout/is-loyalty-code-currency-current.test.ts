import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { isLoyaltyCodeCurrencyCurrent } from './is-loyalty-code-currency-current';

function clientWith(result: { data: unknown; error: unknown }): SupabaseClient {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => result),
        })),
      })),
    })),
  } as unknown as SupabaseClient;
}

describe('isLoyaltyCodeCurrencyCurrent', () => {
  it('is current when the resolved merchant currency matches', async () => {
    const current = await isLoyaltyCodeCurrencyCurrent(
      clientWith({
        data: { country: 'NG', payout_currency: 'NGN' },
        error: null,
      }),
      'm',
      'NGN'
    );

    expect(current).toBe(true);
  });

  it('is stale when the merchant currency moved after issuance', async () => {
    const current = await isLoyaltyCodeCurrencyCurrent(
      clientWith({
        data: { country: 'US', payout_currency: 'USD' },
        error: null,
      }),
      'm',
      'NGN'
    );

    expect(current).toBe(false);
  });

  it('falls back to the country currency when payout is not an ISO code', async () => {
    const current = await isLoyaltyCodeCurrencyCurrent(
      clientWith({
        data: { country: 'GH', payout_currency: null },
        error: null,
      }),
      'm',
      'GHS'
    );

    expect(current).toBe(true);
  });

  it('treats a failed lookup as current (the wrapper decides)', async () => {
    const current = await isLoyaltyCodeCurrencyCurrent(
      clientWith({ data: null, error: { message: 'db down' } }),
      'm',
      'USD'
    );

    expect(current).toBe(true);
  });

  it('treats a missing merchant row as current', async () => {
    const current = await isLoyaltyCodeCurrencyCurrent(
      clientWith({ data: null, error: null }),
      'm',
      'USD'
    );

    expect(current).toBe(true);
  });
});
