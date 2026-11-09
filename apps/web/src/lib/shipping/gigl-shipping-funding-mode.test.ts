import { describe, expect, it, vi } from 'vitest';
import {
  readGiglShippingFundingMode,
  resolveAdminGiglQuoteFunding,
} from './gigl-shipping-funding-mode';

function client(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { rpc, supabase: { rpc } as never };
}

describe('readGiglShippingFundingMode', () => {
  it('reads the DEFINER RPC for the merchant', async () => {
    const { rpc, supabase } = client({ data: 'platform', error: null });
    await expect(readGiglShippingFundingMode(supabase, 'm1')).resolves.toBe(
      'platform'
    );
    expect(rpc).toHaveBeenCalledWith('get_gigl_shipping_funding_mode', {
      p_merchant_id: 'm1',
    });
  });

  it('falls back to merchant_wallet on RPC errors or unknown values', async () => {
    await expect(
      readGiglShippingFundingMode(
        client({ data: null, error: { message: 'boom' } }).supabase,
        'm1'
      )
    ).resolves.toBe('merchant_wallet');
    await expect(
      readGiglShippingFundingMode(
        client({ data: 'free', error: null }).supabase,
        'm1'
      )
    ).resolves.toBe('merchant_wallet');
  });
});

describe('resolveAdminGiglQuoteFunding', () => {
  it('marks platform merchants as paid by Baci without reading a wallet', async () => {
    const readBalance = vi.fn();
    const { supabase } = client({ data: 'platform', error: null });
    await expect(
      resolveAdminGiglQuoteFunding(supabase, 'm1', 4500, readBalance)
    ).resolves.toEqual({
      ok: true,
      availableBalance: 0,
      shortfall: 0,
      canBook: true,
      paidByBaci: true,
    });
    expect(readBalance).not.toHaveBeenCalled();
  });

  it('keeps wallet funding (and the shortfall) for normal merchants', async () => {
    const { supabase } = client({ data: 'merchant_wallet', error: null });
    const readBalance = vi.fn().mockResolvedValue(1000);
    await expect(
      resolveAdminGiglQuoteFunding(supabase, 'm1', 4500, readBalance)
    ).resolves.toEqual({
      ok: true,
      availableBalance: 1000,
      shortfall: 3500,
      canBook: false,
    });
  });

  it('fails when a normal merchant wallet cannot be read', async () => {
    const { supabase } = client({ data: 'merchant_wallet', error: null });
    await expect(
      resolveAdminGiglQuoteFunding(supabase, 'm1', 4500, async () => null)
    ).resolves.toEqual({ ok: false });
  });
});
