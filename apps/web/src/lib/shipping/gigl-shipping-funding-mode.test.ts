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

  it('bugfix: an existing wallet reservation stays wallet-funded after the owner flags the merchant', async () => {
    const { supabase, rpc } = client({ data: 'platform', error: null });
    const readBalance = vi.fn().mockResolvedValue(10000);
    await expect(
      resolveAdminGiglQuoteFunding(supabase, 'm1', 4500, readBalance, {
        existingChargeFundingSource: 'merchant_wallet',
      })
    ).resolves.toEqual({
      ok: true,
      availableBalance: 10000,
      shortfall: 0,
      canBook: true,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('keeps an existing platform reservation paid by Baci while the flag is on', async () => {
    const { supabase } = client({ data: 'platform', error: null });
    await expect(
      resolveAdminGiglQuoteFunding(supabase, 'm1', 4500, vi.fn(), {
        existingChargeFundingSource: 'platform',
      })
    ).resolves.toMatchObject({ canBook: true, paidByBaci: true });
  });

  it('bugfix: falls back to wallet funding for a platform reservation once the flag is revoked', async () => {
    const { supabase } = client({ data: 'merchant_wallet', error: null });
    const result = await resolveAdminGiglQuoteFunding(
      supabase,
      'm1',
      4500,
      async () => 1000,
      { existingChargeFundingSource: 'platform' }
    );
    expect(result).toMatchObject({ ok: true, canBook: false });
    expect(result).not.toHaveProperty('paidByBaci');
  });
});

describe('bugfix: platform funding with a non-positive price', () => {
  it('does not mark a zero price as bookable', async () => {
    const { supabase } = client({ data: 'platform', error: null });
    await expect(
      resolveAdminGiglQuoteFunding(supabase, 'm1', 0, vi.fn())
    ).resolves.toMatchObject({ ok: true, canBook: false, paidByBaci: true });
  });
});

describe('bugfix: funding-mode RPC throws', () => {
  it('falls back to merchant_wallet when the RPC rejects', async () => {
    const supabase = {
      rpc: vi.fn().mockRejectedValue(new Error('network abort')),
    } as never;
    await expect(readGiglShippingFundingMode(supabase, 'm1')).resolves.toBe(
      'merchant_wallet'
    );
  });
});
