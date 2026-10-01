import { describe, expect, it, vi } from 'vitest';
import { resolveMerchantDetails } from './resolve-quote-merchant-details';

function createSupabase(result: unknown) {
  const select = vi.fn();
  const query = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  select.mockReturnValue(query);
  return {
    from: vi.fn(() => ({ select })),
    select,
  };
}

describe('resolveMerchantDetails', () => {
  it('returns the sender fields and merchant currency context', async () => {
    const supabase = createSupabase({
      data: {
        business_address: '1 Merchant Road, Ikeja, Lagos',
        business_name: 'Merchant Store',
        phone: '08012345678',
        country: 'NG',
        payout_currency: 'NGN',
      },
      error: null,
    });
    const result = await resolveMerchantDetails(
      supabase as never,
      'merchant-1'
    );

    expect(result).toEqual(
      expect.objectContaining({ business_name: 'Merchant Store' })
    );
    expect(result).not.toHaveProperty('state_code');
    expect(supabase.select).toHaveBeenCalledWith(
      'business_name, business_address, phone, country, payout_currency'
    );
  });

  it('returns null when the merchant is not found', async () => {
    await expect(
      resolveMerchantDetails(
        createSupabase({ data: null, error: null }) as never,
        'merchant-1'
      )
    ).resolves.toBeNull();
  });

  it('returns a retryable error when the lookup fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(
      resolveMerchantDetails(
        createSupabase({
          data: null,
          error: { message: 'unavailable' },
        }) as never,
        'merchant-1'
      )
    ).resolves.toEqual({
      error: 'Failed to resolve merchant sender',
      ok: false,
      status: 500,
    });

    consoleError.mockRestore();
  });
});
