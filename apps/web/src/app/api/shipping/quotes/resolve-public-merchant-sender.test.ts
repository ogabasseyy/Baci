import { describe, expect, it, vi } from 'vitest';
import { resolvePublicMerchantSender } from './resolve-public-merchant-sender';

function createSupabase(result: unknown) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
  };
}

describe('resolvePublicMerchantSender', () => {
  it('maps the published projection into a carrier sender', async () => {
    const supabase = createSupabase({
      data: {
        business_name: 'Abuja Store',
        business_address: '29 Yedseram Crescent, Maitama, 904101',
        phone: '08012345678',
        country: 'NG',
        state_code: 'FC',
      },
      error: null,
    });

    const result = await resolvePublicMerchantSender(
      supabase as never,
      'merchant-1'
    );

    expect(supabase.rpc).toHaveBeenCalledWith(
      'get_storefront_shipping_sender',
      { p_merchant_id: 'merchant-1' }
    );
    expect(result).toEqual({
      ok: true,
      sender: expect.objectContaining({
        city: 'Maitama',
        state: 'Abuja',
        countryCode: 'NG',
      }),
      country: 'NG',
    });
  });

  it('returns no sender for an empty public projection', async () => {
    const result = await resolvePublicMerchantSender(
      createSupabase({ data: {}, error: null }) as never,
      'merchant-1'
    );

    expect(result).toEqual({ ok: true, sender: null, country: null });
  });

  it('surfaces projection failures without fabricating an origin', async () => {
    const error = { code: 'PGRST202', message: 'function unavailable' };

    await expect(
      resolvePublicMerchantSender(
        createSupabase({ data: null, error }) as never,
        'merchant-1'
      )
    ).resolves.toEqual({ error, ok: false });
  });
});
