import { describe, expect, it, vi } from 'vitest';
import {
  loadJumiaMarketplaceCurrency,
  resolveJumiaMarketplaceCurrency,
  validateJumiaMarketplaceCurrencyForMerchant,
} from './jumia-marketplace-currency';

describe('resolveJumiaMarketplaceCurrency', () => {
  it('maps supported Jumia marketplace countries to their currencies', () => {
    expect(resolveJumiaMarketplaceCurrency('MA')).toEqual({
      ok: true,
      currency: 'MAD',
    });
    expect(resolveJumiaMarketplaceCurrency('ng')).toEqual({
      ok: true,
      currency: 'NGN',
    });
  });

  it('rejects unsupported marketplace countries instead of defaulting to USD', () => {
    expect(resolveJumiaMarketplaceCurrency('US')).toEqual({
      ok: false,
      error: 'Jumia marketplace country US is not supported',
    });
  });
});

function createCurrencySupabase(result: {
  data: { country_code?: string } | null;
  error: unknown;
}) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue(result),
            }),
          }),
        }),
      }),
    }),
  };
}

function createMerchantCurrencySupabase(result: {
  data: { payout_currency?: string } | null;
  error: unknown;
}) {
  const chain = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  chain.eq.mockReturnValue(chain);
  return {
    from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(chain) }),
  };
}

describe('loadJumiaMarketplaceCurrency', () => {
  it('derives currency from the integration marketplace country', async () => {
    await expect(
      loadJumiaMarketplaceCurrency(
        createCurrencySupabase({
          data: { country_code: 'GH' },
          error: null,
        }) as never,
        'merchant-1',
        'integration-1'
      )
    ).resolves.toEqual({ ok: true, currency: 'GHS' });
  });

  it('rejects a missing marketplace country code instead of defaulting to NGN', async () => {
    await expect(
      loadJumiaMarketplaceCurrency(
        createCurrencySupabase({ data: {}, error: null }) as never,
        'merchant-1',
        'integration-1'
      )
    ).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Jumia integration is missing a marketplace country code',
    });
  });

  it('propagates integration lookup errors instead of falling back to NGN', async () => {
    await expect(
      loadJumiaMarketplaceCurrency(
        createCurrencySupabase({
          data: null,
          error: { message: 'DB down' },
        }) as never,
        'merchant-1',
        'integration-1'
      )
    ).resolves.toEqual({
      ok: false,
      status: 500,
      error: 'Failed to load Jumia integration currency',
    });
  });
});

describe('validateJumiaMarketplaceCurrencyForMerchant', () => {
  it('accepts a marketplace currency matching merchant payout currency', async () => {
    await expect(
      validateJumiaMarketplaceCurrencyForMerchant(
        createMerchantCurrencySupabase({
          data: { payout_currency: 'ngn' },
          error: null,
        }) as never,
        'merchant-1',
        'NGN'
      )
    ).resolves.toEqual({ ok: true });
  });

  it('rejects a currency mismatch before syncing prices', async () => {
    await expect(
      validateJumiaMarketplaceCurrencyForMerchant(
        createMerchantCurrencySupabase({
          data: { payout_currency: 'GHS' },
          error: null,
        }) as never,
        'merchant-1',
        'NGN'
      )
    ).resolves.toEqual({
      ok: false,
      status: 400,
      error:
        'Jumia marketplace currency NGN does not match merchant payout currency GHS',
    });
  });
});
