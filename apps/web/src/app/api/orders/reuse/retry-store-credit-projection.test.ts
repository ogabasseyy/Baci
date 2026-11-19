import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRecordPreGatewayRedemption = vi.fn();

vi.mock('@/lib/payments/record-pre-gateway-redemption', () => ({
  recordPreGatewayRedemption: (...args: unknown[]) =>
    mockRecordPreGatewayRedemption(...args),
}));

import { retryOrderStoreCreditProjection } from './retry-store-credit-projection';

function createSupabaseMock({
  walletData = [],
  walletError = null,
  savingsData = [],
  savingsError = null,
}: {
  walletData?: Array<{ amount?: unknown }> | null;
  walletError?: { message: string } | null;
  savingsData?: Array<{
    amount?: unknown;
    metadata?: Record<string, unknown> | null;
  }> | null;
  savingsError?: { message: string } | null;
} = {}) {
  const walletBuilder = {
    select: vi.fn(),
    eq: vi.fn(),
  };
  walletBuilder.select.mockReturnValue(walletBuilder);
  walletBuilder.eq
    .mockReturnValueOnce(walletBuilder)
    .mockReturnValueOnce(walletBuilder)
    .mockReturnValueOnce(walletBuilder)
    .mockResolvedValueOnce({ data: walletData, error: walletError });

  const savingsBuilder = {
    select: vi.fn(),
    eq: vi.fn(),
  };
  savingsBuilder.select.mockReturnValue(savingsBuilder);
  savingsBuilder.eq.mockResolvedValueOnce({
    data: savingsData,
    error: savingsError,
  });

  return {
    from: vi.fn((table: string) => {
      if (table === 'customer_wallet_transactions') return walletBuilder;
      if (table === 'customer_savings_redemptions') return savingsBuilder;
      throw new Error(`Unexpected table: ${table}`);
    }),
  } as unknown as SupabaseClient;
}

describe('retryOrderStoreCreditProjection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordPreGatewayRedemption.mockResolvedValue(null);
  });

  it('rejects invalid or non-positive order totals', async () => {
    const supabase = createSupabaseMock();

    const result = await retryOrderStoreCreditProjection({
      supabase,
      orderId: 'order-1',
      orderTotal: 0,
    });

    expect('response' in result).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(409);
      await expect(result.response.json()).resolves.toEqual({
        error: 'Store credit requires payment review.',
        code: 'STORE_CREDIT_REVIEW_REQUIRED',
      });
    }
    expect(mockRecordPreGatewayRedemption).not.toHaveBeenCalled();
  });

  it('fails closed when ledger queries error', async () => {
    const supabase = createSupabaseMock({
      walletError: { message: 'rls error' },
    });

    const result = await retryOrderStoreCreditProjection({
      supabase,
      orderId: 'order-1',
      orderTotal: 15000,
    });

    expect('response' in result).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(409);
      await expect(result.response.json()).resolves.toMatchObject({
        code: 'STORE_CREDIT_REVIEW_REQUIRED',
      });
    }
    expect(mockRecordPreGatewayRedemption).not.toHaveBeenCalled();
  });

  it('fails closed when no active funding ledger rows are visible', async () => {
    const supabase = createSupabaseMock({
      walletData: [],
      savingsData: [{ amount: 5000, metadata: { reversed_at: '2026-11-18' } }],
    });

    const result = await retryOrderStoreCreditProjection({
      supabase,
      orderId: 'order-1',
      orderTotal: 15000,
    });

    expect('response' in result).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(409);
      await expect(result.response.json()).resolves.toMatchObject({
        code: 'STORE_CREDIT_REVIEW_REQUIRED',
      });
    }
    expect(mockRecordPreGatewayRedemption).not.toHaveBeenCalled();
  });

  it('sums active wallet and non-reversed savings debits and projects the order', async () => {
    const supabase = createSupabaseMock({
      walletData: [{ amount: 4000 }],
      savingsData: [
        { amount: 2500, metadata: null },
        { amount: 1500, metadata: { reversed_at: '2026-11-18T10:00:00Z' } },
      ],
    });

    const result = await retryOrderStoreCreditProjection({
      supabase,
      orderId: 'order-1',
      orderTotal: 10000,
    });

    expect(mockRecordPreGatewayRedemption).toHaveBeenCalledWith(
      'order-1',
      10000,
      2500,
      4000,
      supabase
    );
    expect(result).toEqual({ amountDueToGateway: 3500 });
  });

  it('propagates projection failure responses from recordPreGatewayRedemption', async () => {
    mockRecordPreGatewayRedemption.mockResolvedValue({
      message: 'Store credit is temporarily busy.',
      code: 'STORE_CREDIT_RETRY_REQUIRED',
      status: 503,
    });
    const supabase = createSupabaseMock({
      walletData: [{ amount: 10000 }],
    });

    const result = await retryOrderStoreCreditProjection({
      supabase,
      orderId: 'order-1',
      orderTotal: 10000,
    });

    expect('response' in result).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(503);
      await expect(result.response.json()).resolves.toEqual({
        error: 'Store credit is temporarily busy.',
        code: 'STORE_CREDIT_RETRY_REQUIRED',
      });
    }
  });
});
