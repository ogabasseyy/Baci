import { describe, expect, it, vi } from 'vitest';
import { readMerchantShippingWalletBalance } from './merchant-shipping-wallet-balance';

function client(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { rpc, supabase: { rpc } as never };
}

describe('readMerchantShippingWalletBalance', () => {
  it('reads the narrow balance RPC for the resolved merchant', async () => {
    const { rpc, supabase } = client({ data: 1250.5, error: null });
    await expect(
      readMerchantShippingWalletBalance(supabase, 'merchant-1')
    ).resolves.toEqual({ ok: true, availableBalance: 1250.5 });
    expect(rpc).toHaveBeenCalledWith('get_merchant_shipping_wallet_balance', {
      p_merchant_id: 'merchant-1',
    });
    expect(rpc).not.toHaveBeenCalledWith(
      'get_wallet_summary',
      expect.anything()
    );
  });

  it('accepts a numeric string and treats a null balance as zero', async () => {
    await expect(
      readMerchantShippingWalletBalance(
        client({ data: '300.25', error: null }).supabase,
        'm'
      )
    ).resolves.toEqual({ ok: true, availableBalance: 300.25 });
    await expect(
      readMerchantShippingWalletBalance(
        client({ data: null, error: null }).supabase,
        'm'
      )
    ).resolves.toEqual({ ok: true, availableBalance: 0 });
  });

  it('fails closed when the caller lacks orders.fulfill', async () => {
    await expect(
      readMerchantShippingWalletBalance(
        client({
          data: null,
          error: {
            code: '42501',
            message: 'merchant_shipping_wallet_balance_forbidden',
          },
        }).supabase,
        'm'
      )
    ).resolves.toEqual({ ok: false });
  });

  it('rejects a malformed RPC payload instead of guessing a balance', async () => {
    await expect(
      readMerchantShippingWalletBalance(
        client({ data: [{ available_balance: 10 }], error: null }).supabase,
        'm'
      )
    ).resolves.toEqual({ ok: false });
  });
});
