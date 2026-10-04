import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { resolvePlanWalletMapping } from './plan-wallet-mapping';

const ROW = {
  customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
  merchant_id: '43e157b6-179c-432a-9392-e0827da96d82',
  piggyvest_customer_id: 'pvb-customer-synthetic-001',
  wallet_id: 'pvb-wallet-synthetic-001',
  status: 'ready',
};

function mockSupabase(result: { data: unknown; error: unknown }): {
  client: SupabaseClient;
  from: ReturnType<typeof vi.fn>;
} {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    eq: vi.fn(() => chain),
    maybeSingle: async () => result,
    select: vi.fn(() => chain),
  });
  const from = vi.fn(() => chain);
  return { client: { from } as unknown as SupabaseClient, from };
}

describe('resolvePlanWalletMapping', () => {
  it('resolves a matching provider customer/wallet pair', async () => {
    const { client, from } = mockSupabase({ data: ROW, error: null });

    const mapping = await resolvePlanWalletMapping(client, {
      piggyvestCustomerId: 'pvb-customer-synthetic-001',
      walletId: 'pvb-wallet-synthetic-001',
    });

    expect(mapping).toMatchObject({
      customer_id: ROW.customer_id,
      merchant_id: ROW.merchant_id,
    });
    expect(from).toHaveBeenCalledWith('piggyvest_plan_wallets');
  });

  it('returns null for an unknown wallet', async () => {
    const { client } = mockSupabase({ data: null, error: null });

    await expect(
      resolvePlanWalletMapping(client, {
        piggyvestCustomerId: 'pvb-customer-synthetic-001',
        walletId: 'pvb-wallet-unknown',
      })
    ).resolves.toBeNull();
  });

  it('returns null on a customer mismatch instead of another tenant', async () => {
    const { client } = mockSupabase({ data: ROW, error: null });

    await expect(
      resolvePlanWalletMapping(client, {
        piggyvestCustomerId: 'pvb-customer-other',
        walletId: 'pvb-wallet-synthetic-001',
      })
    ).resolves.toBeNull();
  });

  it('fails closed on storage errors', async () => {
    const { client } = mockSupabase({
      data: null,
      error: { message: 'db down' },
    });

    await expect(
      resolvePlanWalletMapping(client, {
        piggyvestCustomerId: 'pvb-customer-synthetic-001',
        walletId: 'pvb-wallet-synthetic-001',
      })
    ).rejects.toThrow('Plan wallet mapping lookup failed');
  });
});

