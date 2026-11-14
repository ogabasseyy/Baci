import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/supabase';
import { fetchCustomerWallet, getCustomerSavingsEarnings } from './wallet-data';

/**
 * Builds a minimal supabase double whose `from(table)` returns a chainable
 * query. `wallet` resolves the `.single()` leaf; `transactions` resolves the
 * `.limit()` leaf — the two shapes `fetchCustomerWallet` walks.
 */
function supabaseDouble(config: {
  transactions?: { data: unknown[] | null; error: unknown };
  wallet: { data: unknown; error: unknown };
}) {
  const walletQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(config.wallet),
  };
  const transactionsQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi
      .fn()
      .mockResolvedValue(config.transactions ?? { data: [], error: null }),
  };
  return {
    from: vi.fn((table: string) =>
      table === 'customer_wallets' ? walletQuery : transactionsQuery
    ),
  } as unknown as SupabaseClient<Database>;
}

describe('fetchCustomerWallet', () => {
  const args = {
    customerId: 'customer-1',
    merchantId: 'merchant-1',
  };

  it('returns the balance and baseline transactions on the happy path', async () => {
    const supabase = supabaseDouble({
      wallet: {
        data: {
          available_balance: '5000',
          id: 'wallet-1',
          total_earned: '5000',
          total_redeemed: '0',
        },
        error: null,
      },
      transactions: {
        data: [{ id: 'txn-1', source_type: 'wallet_topup', type: 'credit' }],
        error: null,
      },
    });

    const result = await fetchCustomerWallet({ ...args, supabase });

    expect(result).toEqual({
      availableBalance: 5000,
      kind: 'ok',
      totalEarned: 5000,
      totalRedeemed: 0,
      transactions: [
        {
          description: 'Wallet top-up',
          id: 'txn-1',
          source_type: 'wallet_topup',
          type: 'credit',
        },
      ],
    });
  });

  it('never shows a customer the provider or lookup id behind a transaction', async () => {
    const supabase = supabaseDouble({
      wallet: {
        data: {
          available_balance: '0',
          id: 'wallet-1',
          total_earned: '0',
          total_redeemed: '5000',
        },
        error: null,
      },
      transactions: {
        data: [
          {
            description:
              'Petrock IMEI lookup payment: 3f2b8c1e-1d2a-4c3b-9e8f-0a1b2c3d4e5f',
            id: 'txn-2',
            source_type: 'imei_wallet_payment',
            type: 'redemption',
          },
          {
            description: 'Partial invoice payment via paystack',
            id: 'txn-3',
            source_type: null,
            type: 'debit',
          },
          {
            description: 'PiggyVest bank transfer',
            id: 'txn-4',
            source_type: 'piggyvest_primary_inflow',
            type: 'credit',
          },
        ],
        error: null,
      },
    });

    const result = await fetchCustomerWallet({ ...args, supabase });

    if (result.kind !== 'ok') throw new Error('expected ok');
    // Only the text a customer reads is relabeled: source_type is a machine
    // field older apps branch on, so it keeps its value.
    const descriptions = result.transactions.map((tx) => tx.description);
    expect(descriptions.join(' ')).not.toMatch(
      /petrock|paystack|piggyvest|3f2b8c1e/i
    );
    expect(descriptions).toEqual([
      'IMEI check',
      'Partial invoice payment',
      'Money added',
    ]);
  });

  it('maps PGRST116 ("no row") to no-wallet, not an error', async () => {
    const supabase = supabaseDouble({
      wallet: { data: null, error: { code: 'PGRST116' } },
    });

    const result = await fetchCustomerWallet({ ...args, supabase });

    expect(result).toEqual({ kind: 'no-wallet' });
  });

  it('fails closed (kind: error) when the wallet lookup errors for another reason', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const supabase = supabaseDouble({
      wallet: { data: null, error: { code: '57014', message: 'cancelled' } },
    });

    const result = await fetchCustomerWallet({ ...args, supabase });

    expect(result).toEqual({ kind: 'error' });
    consoleErrorSpy.mockRestore();
  });

  it('fails closed (kind: error) when the transactions read errors — never an empty baseline', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const supabase = supabaseDouble({
      wallet: {
        data: { available_balance: '5000', id: 'wallet-1' },
        error: null,
      },
      transactions: { data: [], error: { message: 'statement timeout' } },
    });

    const result = await fetchCustomerWallet({ ...args, supabase });

    expect(result).toEqual({ kind: 'error' });
    consoleErrorSpy.mockRestore();
  });
});

describe('getCustomerSavingsEarnings', () => {
  it('marks earnings unavailable when the RPC request rejects', async () => {
    const supabase = {
      rpc: vi.fn().mockRejectedValue(new Error('network unavailable')),
    } as unknown as SupabaseClient<Database>;

    await expect(
      getCustomerSavingsEarnings({ merchantId: 'merchant-1', supabase })
    ).resolves.toEqual({ earningsAvailable: false, earningsBalance: null });
  });
});
