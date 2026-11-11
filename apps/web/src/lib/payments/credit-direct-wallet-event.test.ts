import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { verifyCreditDirectWalletEvent } from './credit-direct-wallet-event';

const args = {
  orderId: 'order',
  merchantId: 'merchant',
  reference: 'provider',
  merchantCompleted: true,
  providerAmount: 30000,
};
function client(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { rpc, supabase: { rpc } as unknown as Pick<SupabaseClient, 'rpc'> };
}
describe('verified Credit Direct wallet funding', () => {
  it('uses the durable funding basis returned by the verified webhook boundary', async () => {
    const funding = {
      grossAmount: 50000,
      walletAmount: 20000,
      financedAmount: 30000,
    };
    const { rpc, supabase } = client(funding);
    expect(await verifyCreditDirectWalletEvent({ ...args, supabase })).toEqual(
      funding
    );
    expect(rpc).toHaveBeenCalledWith('verify_credit_direct_wallet_event', {
      p_order_id: 'order',
      p_merchant_id: 'merchant',
      p_reference: 'provider',
      p_merchant_completed: true,
      p_provider_amount: 30000,
    });
  });
  it.each([
    null,
    0,
    -1,
    Number.NaN,
  ])('rejects invalid provider amount %s before binding evidence', async (providerAmount) => {
    const { rpc, supabase } = client(null);
    expect(
      await verifyCreditDirectWalletEvent({ ...args, providerAmount, supabase })
    ).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { grossAmount: 50000, walletAmount: 20000, financedAmount: 50000 },
  ])('retries a malformed RPC response without accepting funding evidence', async (data) => {
    const { supabase } = client(data);
    expect(await verifyCreditDirectWalletEvent({ ...args, supabase })).toBe(
      'retry'
    );
  });
  it('distinguishes a retryable reservation conflict from invalid funding evidence', async () => {
    const { supabase } = client(null, { code: '40001' });
    expect(await verifyCreditDirectWalletEvent({ ...args, supabase })).toBe(
      'retry'
    );
  });

  it('fails closed on an unbound attempt or conflicting provider reference', async () => {
    const { supabase } = client(null, {
      message: 'credit_direct_wallet_reconciliation_required',
    });
    expect(
      await verifyCreditDirectWalletEvent({ ...args, supabase })
    ).toBeNull();
  });
});

it('retries an unexpected database failure', async () => {
  const { supabase } = client(null, {
    code: '08006',
    message: 'connection failed',
  });
  expect(await verifyCreditDirectWalletEvent({ ...args, supabase })).toBe(
    'retry'
  );
});
