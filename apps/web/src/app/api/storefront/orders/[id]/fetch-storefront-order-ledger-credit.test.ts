import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchStorefrontOrderLedgerCredit,
  requiresStorefrontOrderLedgerCredit,
} from './fetch-storefront-order-ledger-credit';

function createScopedLedgerMock({
  walletRows = [],
  savingsRows = [],
  walletError = null,
  savingsError = null,
}: {
  walletRows?: Record<string, unknown>[];
  savingsRows?: Record<string, unknown>[];
  walletError?: unknown;
  savingsError?: unknown;
}) {
  const filters: Record<string, [string, unknown][]> = {
    customer_wallet_transactions: [],
    customer_savings_redemptions: [],
  };

  const makeChain = (
    table: 'customer_wallet_transactions' | 'customer_savings_redemptions',
    rows: Record<string, unknown>[],
    error: unknown
  ) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => {
        filters[table].push([column, value]);
        return chain;
      }),
      // biome-ignore lint/suspicious/noThenProperty: Supabase query builder is awaitable.
      then: (
        onFulfilled?: ((value: unknown) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null
      ) =>
        Promise.resolve(
          error ? { data: null, error } : { data: rows, error: null }
        ).then(onFulfilled, onRejected),
    };
    return chain;
  };

  const supabase: Pick<SupabaseClient, 'from'> = {
    from: vi.fn((table: string) => {
      if (table === 'customer_wallet_transactions') {
        return makeChain(
          'customer_wallet_transactions',
          walletRows,
          walletError
        ) as unknown as ReturnType<SupabaseClient['from']>;
      }
      if (table === 'customer_savings_redemptions') {
        return makeChain(
          'customer_savings_redemptions',
          savingsRows,
          savingsError
        ) as unknown as ReturnType<SupabaseClient['from']>;
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { supabase, filters };
}

describe('fetchStorefrontOrderLedgerCredit', () => {
  it('identifies BNPL payment methods that require ledger credit lookups', () => {
    expect(requiresStorefrontOrderLedgerCredit('oxygen')).toBe(true);
    expect(requiresStorefrontOrderLedgerCredit(' Klump ')).toBe(true);
    expect(requiresStorefrontOrderLedgerCredit('CREDIT_DIRECT')).toBe(true);
    expect(requiresStorefrontOrderLedgerCredit('paystack')).toBe(false);
    expect(requiresStorefrontOrderLedgerCredit(null)).toBe(false);
  });

  it('scopes wallet and savings ledger queries by merchantId and customerId and excludes reversed entries', async () => {
    const { supabase, filters } = createScopedLedgerMock({
      walletRows: [
        {
          amount: 10000,
          status: 'completed',
          source_type: 'order_redemption',
          type: 'redemption',
        },
        {
          amount: 2500,
          status: 'completed',
          source_type: 'order_reversal',
          type: 'credit',
        },
      ],
      savingsRows: [
        { amount: 5000, metadata: {} },
        { amount: 3000, metadata: { reversed_at: '2026-11-26T00:00:00Z' } },
      ],
    });

    const result = await fetchStorefrontOrderLedgerCredit(
      supabase,
      'order-123',
      {
        merchantId: 'merchant-1',
        customerId: 'customer-1',
      }
    );

    expect(result).toEqual({
      ok: true,
      walletLedgerUsed: 7500,
      savingsLedgerUsed: 5000,
      walletReversalCompleted: true,
      walletReversedCredit: 2500,
    });
    expect(filters.customer_wallet_transactions).toEqual([
      ['source_id', 'order-123'],
      ['merchant_id', 'merchant-1'],
      ['customer_id', 'customer-1'],
    ]);
    expect(filters.customer_savings_redemptions).toEqual([
      ['order_id', 'order-123'],
      ['merchant_id', 'merchant-1'],
      ['customer_id', 'customer-1'],
    ]);
  });

  it('fails closed when either wallet or savings ledger query returns an error', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      const { supabase } = createScopedLedgerMock({
        savingsError: { message: 'db down' },
      });

      const result = await fetchStorefrontOrderLedgerCredit(
        supabase,
        'order-123'
      );

      expect(result).toEqual({ ok: false });
      expect(consoleErrorSpy).toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
