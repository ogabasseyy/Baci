import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { readOrderPayableState } from './read-order-payable-state';

function createMockPaymentClient(options: {
  walletResult: { data: unknown; error: unknown };
  savingsResult: { data: unknown; error: unknown };
}) {
  return {
    rpc: vi.fn(),
    from: vi.fn((table: string) => {
      if (table === 'customer_wallet_transactions') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve(options.walletResult),
            }),
          }),
        };
      }
      if (table === 'customer_savings_redemptions') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve(options.savingsResult),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table read: ${table}`);
    }),
  } as unknown as SupabaseClient;
}

describe('readOrderPayableState (REDVAULT ledger parity)', () => {
  it('subtracts completed wallet ledger redemptions on REDVAULT orders even when snapshot wallet_amount_used is 0', async () => {
    const paymentDataClient = createMockPaymentClient({
      walletResult: {
        data: [
          {
            amount: 1500,
            status: 'completed',
            source_type: 'order_redemption',
            type: 'redemption',
          },
        ],
        error: null,
      },
      savingsResult: { data: [], error: null },
    });

    const result = await readOrderPayableState({
      paymentDataClient,
      orderId: 'order-1',
      merchantId: 'merchant-1',
      customerEmail: 'buyer@example.com',
      redvaultRequested: true,
      initialOrderSnapshot: {
        total: 5000,
        wallet_amount_used: 0,
        amount_paid: 0,
        payment_status: 'unpaid',
      },
      snapshotTotal: 5000,
    });

    expect(result).toEqual({
      ok: true,
      payableAmount: 3500,
      walletAmountUsed: 1500,
      savingsAmountUsed: 0,
    });
  });

  it('fails closed with ORDER_WALLET_LOOKUP_FAILED when the REDVAULT wallet ledger query errors', async () => {
    const paymentDataClient = createMockPaymentClient({
      walletResult: {
        data: null,
        error: { message: 'permission denied' },
      },
      savingsResult: { data: [], error: null },
    });

    const result = await readOrderPayableState({
      paymentDataClient,
      orderId: 'order-1',
      merchantId: 'merchant-1',
      customerEmail: 'buyer@example.com',
      redvaultRequested: true,
      initialOrderSnapshot: {
        total: 5000,
        wallet_amount_used: 0,
        amount_paid: 0,
        payment_status: 'unpaid',
      },
      snapshotTotal: 5000,
    });

    expect(result).toEqual({
      ok: false,
      message: 'Unable to verify order wallet amount',
      code: 'ORDER_WALLET_LOOKUP_FAILED',
      status: 500,
    });
  });
});
