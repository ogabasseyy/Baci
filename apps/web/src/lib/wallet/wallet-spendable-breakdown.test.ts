import { describe, expect, it, vi } from 'vitest';
import { readWalletSpendableBreakdown } from './wallet-spendable-breakdown';

function client(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { rpc, supabase: { rpc } as never };
}

describe('readWalletSpendableBreakdown', () => {
  it('maps the RPC row to spendable and settled-to-bank figures', async () => {
    const { rpc, supabase } = client({
      data: [{ spendable_balance: '0', settled_to_bank_total: '10549750.09' }],
      error: null,
    });
    await expect(
      readWalletSpendableBreakdown(supabase, 'merchant-1')
    ).resolves.toEqual({
      ok: true,
      spendableBalance: 0,
      settledToBankTotal: 10549750.09,
    });
    expect(rpc).toHaveBeenCalledWith(
      'get_merchant_wallet_spendable_breakdown',
      {
        p_merchant_id: 'merchant-1',
      }
    );
  });

  it('treats a merchant without a wallet row as zero and zero', async () => {
    await expect(
      readWalletSpendableBreakdown(
        client({ data: [], error: null }).supabase,
        'm'
      )
    ).resolves.toEqual({
      ok: true,
      spendableBalance: 0,
      settledToBankTotal: 0,
    });
  });

  it('fails closed on RPC error or malformed data', async () => {
    await expect(
      readWalletSpendableBreakdown(
        client({ data: null, error: { code: '42501' } }).supabase,
        'm'
      )
    ).resolves.toEqual({ ok: false });
    await expect(
      readWalletSpendableBreakdown(
        client({ data: [{ spendable_balance: 'x' }], error: null }).supabase,
        'm'
      )
    ).resolves.toEqual({ ok: false });
  });
});
