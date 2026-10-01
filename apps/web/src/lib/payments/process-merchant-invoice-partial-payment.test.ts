import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { processMerchantInvoicePartialPayment } from '@/lib/payments/process-merchant-invoice-partial-payment';

const transaction = {
  amount: 300000,
  currency: 'NGN',
  gateway_reference: 'PSK-REF-1',
  id: 'txn-1',
  merchant_id: 'merchant-1',
  metadata: {
    order_payment_allocation: 'merchant_invoice_partial',
  },
  order_id: 'order-1',
  platform_fee: 0,
};

const partialCompletion = {
  outcome: 'partial_recorded',
  already_completed: false,
  amount_applied: 300000,
  amount_paid: 300000,
  balance_due: 535000,
  order_number: 'ORD-1',
  payment_status: 'partially_paid',
  shipping_status: 'pending',
};

function buildSupabaseMock(
  rpcResult: { data: unknown; error: unknown },
  reviewError: unknown = null
) {
  const reviewInsert = vi
    .fn()
    .mockResolvedValue({ data: null, error: reviewError });
  const from = vi.fn((table: string) => {
    if (table === 'reconciliation_review') {
      return { insert: reviewInsert };
    }
    throw new Error(`Unexpected table ${table}`);
  });
  return {
    from,
    reviewInsert,
    supabase: {
      from,
      rpc: vi.fn().mockResolvedValue(rpcResult),
    } as unknown as SupabaseClient,
  };
}

const baseArgs = {
  gateway: 'paystack' as const,
  gatewayResponse: { fees: 1000, paid_at: '2026-08-05T08:30:00Z' },
  reference: 'PSK-REF-1',
  transaction,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('processMerchantInvoicePartialPayment', () => {
  it('ignores ordinary gateway transactions', async () => {
    const db = buildSupabaseMock({ data: null, error: null });

    await expect(
      processMerchantInvoicePartialPayment({
        ...baseArgs,
        supabase: db.supabase,
        transaction: { ...transaction, metadata: {} },
      })
    ).resolves.toEqual({ kind: 'none' });

    expect(db.supabase.rpc).not.toHaveBeenCalled();
  });

  it('records and settles a merchant invoice partial in one atomic RPC', async () => {
    const db = buildSupabaseMock({ data: partialCompletion, error: null });

    const result = await processMerchantInvoicePartialPayment({
      ...baseArgs,
      supabase: db.supabase,
    });

    expect(db.supabase.rpc).toHaveBeenCalledWith(
      'complete_merchant_invoice_partial_payment',
      {
        p_actor: 'webhook:PSK-REF-1',
        p_gateway_response: baseArgs.gatewayResponse,
        p_order_id: 'order-1',
        p_payment_platform_fee: 2050,
        p_settlement_reference: 'PSK-REF-1',
        p_transaction_id: 'txn-1',
        p_verified_gateway_fee: 10,
      }
    );
    expect(result).toEqual({
      body: {
        amountPaid: 300000,
        balanceDue: 535000,
        message: 'Merchant invoice partial payment recorded',
        orderNumber: 'ORD-1',
        success: true,
      },
      kind: 'processed',
      status: 200,
    });
  });

  it('accepts an idempotent replay after the atomic transition already completed', async () => {
    const db = buildSupabaseMock({
      data: { ...partialCompletion, already_completed: true },
      error: null,
    });

    await expect(
      processMerchantInvoicePartialPayment({
        ...baseArgs,
        supabase: db.supabase,
      })
    ).resolves.toMatchObject({ kind: 'processed', status: 200 });

    expect(db.supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('hands an exact remaining balance back to standard paid-order completion', async () => {
    const db = buildSupabaseMock({
      data: {
        outcome: 'standard_completion',
        reason: 'amount_now_completes_order',
      },
      error: null,
    });

    await expect(
      processMerchantInvoicePartialPayment({
        ...baseArgs,
        supabase: db.supabase,
      })
    ).resolves.toEqual({ kind: 'none' });
    expect(db.supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('hands an exact-completion replay back to standard paid-order completion', async () => {
    const db = buildSupabaseMock({
      data: {
        outcome: 'standard_completion',
        reason: 'exact_completion_replay',
      },
      error: null,
    });

    await expect(
      processMerchantInvoicePartialPayment({
        ...baseArgs,
        supabase: db.supabase,
      })
    ).resolves.toEqual({ kind: 'none' });
    expect(db.supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('files review instead of handing a terminal order to paid-order completion', async () => {
    const db = buildSupabaseMock({
      data: {
        outcome: 'standard_completion',
        reason: 'order_terminal',
      },
      error: null,
    });

    const result = await processMerchantInvoicePartialPayment({
      ...baseArgs,
      supabase: db.supabase,
    });

    expect(db.reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { error_code: 'ORDER_TERMINAL' },
        order_id: 'order-1',
        txn_id: 'txn-1',
      })
    );
    expect(result).toMatchObject({ kind: 'review', status: 409 });
  });

  it('fails closed when a terminal-order review cannot be filed', async () => {
    const db = buildSupabaseMock(
      {
        data: {
          outcome: 'standard_completion',
          reason: 'order_terminal',
        },
        error: null,
      },
      { message: 'review insert failed' }
    );

    const result = await processMerchantInvoicePartialPayment({
      ...baseArgs,
      supabase: db.supabase,
    });

    expect(db.reviewInsert).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ kind: 'error', status: 500 });
  });

  it('files a durable review instead of guessing after a concurrent balance change', async () => {
    const db = buildSupabaseMock({
      data: {
        outcome: 'review_required',
        error_code: 'AMOUNT_EXCEEDS_REMAINING_BALANCE',
        remaining_balance: 200000,
      },
      error: null,
    });

    const result = await processMerchantInvoicePartialPayment({
      ...baseArgs,
      supabase: db.supabase,
    });

    expect(db.reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'merchant_invoice_partial_payment_conflict',
        order_id: 'order-1',
        paystack_ref: 'PSK-REF-1',
        txn_id: 'txn-1',
      })
    );
    expect(result).toMatchObject({ kind: 'review', status: 409 });
    expect(db.supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('files a durable review before mutation when settlement fees exceed the payment', async () => {
    const db = buildSupabaseMock({ data: partialCompletion, error: null });

    const result = await processMerchantInvoicePartialPayment({
      ...baseArgs,
      supabase: db.supabase,
      transaction: { ...transaction, platform_fee: 300001 },
    });

    expect(db.reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'merchant_invoice_partial_payment_conflict',
        metadata: { error_code: 'SETTLEMENT_INPUT_INVALID' },
      })
    );
    expect(db.supabase.rpc).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: 'review', status: 409 });
  });

  it('fails closed when the atomic RPC errors or returns an invalid payload', async () => {
    const rpcFailure = buildSupabaseMock({
      data: null,
      error: { message: 'database unavailable' },
    });
    await expect(
      processMerchantInvoicePartialPayment({
        ...baseArgs,
        supabase: rpcFailure.supabase,
      })
    ).resolves.toMatchObject({ kind: 'error', status: 500 });

    const invalid = buildSupabaseMock({ data: {}, error: null });
    await expect(
      processMerchantInvoicePartialPayment({
        ...baseArgs,
        supabase: invalid.supabase,
      })
    ).resolves.toMatchObject({ kind: 'error', status: 500 });
  });
});
