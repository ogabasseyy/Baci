import { describe, expect, it, vi } from 'vitest';

const loggerError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', () => ({ logger: { error: loggerError } }));

function reviewTable() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  return { from: vi.fn(() => ({ insert })), insert };
}

import { recordChatOrderSettlement } from '@/lib/payments/record-chat-order-settlement';

const base = {
  gateway: 'paystack',
  grossAmount: 25_000,
  merchantId: 'merchant-1',
  orderId: 'order-1',
  platformFee: 375,
  reference: 'CHAT-REF123',
};

describe('recordChatOrderSettlement', () => {
  it('records a Baci-owned chat DVA payment as a Baci-collected wallet credit', async () => {
    const review = reviewTable();
    // Arrange
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: 'settlement-1', error: null });

    // Act
    await recordChatOrderSettlement({
      ...base,
      gatewayResponse: { fees_split: null, subaccount: {} },
      supabase: { from: review.from, rpc } as never,
    });

    // Assert
    expect(rpc).toHaveBeenCalledWith(
      'record_merchant_settlement',
      expect.objectContaining({
        p_gateway_reference: 'CHAT-REF123',
        p_metadata: {
          paystack_collection: 'integration',
          paystack_reference: 'CHAT-REF123',
        },
        p_platform_fee: 375,
        p_source_id: 'order-1',
      })
    );
  });

  it('surfaces a recorder refusal returned as an RPC error instead of passing as success', async () => {
    const review = reviewTable();
    // Arrange: supabase-js resolves RPC failures, it does not throw them.
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'paystack_direct_settlement_subaccount_mismatch' },
    });

    // Act + Assert
    await expect(
      recordChatOrderSettlement({
        ...base,
        gatewayResponse: {
          amount: 2_500_000,
          fees_split: {
            integration: 0,
            paystack: 37_500,
            subaccount: 2_462_500,
          },
          subaccount: { subaccount_code: 'ACCT_other' },
        },
        supabase: { from: review.from, rpc } as never,
      })
    ).rejects.toThrow(
      'chat_order_settlement_failed: record_paystack_direct_split_settlement: paystack_direct_settlement_subaccount_mismatch'
    );
  });

  it('records nothing when the Paystack payload proves neither collection mode', async () => {
    const review = reviewTable();
    const rpc = vi.fn();

    await expect(
      recordChatOrderSettlement({
        ...base,
        gatewayResponse: { status: 'success' },
        supabase: { from: review.from, rpc } as never,
      })
    ).rejects.toThrow('paystack_settlement_collection_unknown');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('files a durable merchant_settlement_failed review when settlement fails, since Paystack will not redeliver', async () => {
    const review = reviewTable();
    const rpc = vi.fn();

    await expect(
      recordChatOrderSettlement({
        ...base,
        gatewayResponse: { status: 'success' },
        supabase: { from: review.from, rpc } as never,
      })
    ).rejects.toThrow('paystack_settlement_collection_unknown');

    expect(review.from).toHaveBeenCalledWith('reconciliation_review');
    expect(review.insert).toHaveBeenCalledWith({
      issue_type: 'merchant_settlement_failed',
      metadata: {
        error: 'paystack_settlement_collection_unknown',
        gateway: 'paystack',
        source: 'chat_order',
      },
      order_id: 'order-1',
      paystack_ref: 'CHAT-REF123',
      reason:
        'Chat-order settlement was not recorded; reconcile it against the Paystack transaction.',
    });
  });

  it('does not file a review when settlement succeeds', async () => {
    const review = reviewTable();
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: 'settlement-1', error: null });

    await recordChatOrderSettlement({
      ...base,
      gatewayResponse: { fees_split: null, subaccount: {} },
      supabase: { from: review.from, rpc } as never,
    });

    expect(review.insert).not.toHaveBeenCalled();
  });

  it('keeps the original settlement error and logs both when the review insert fails', async () => {
    const insert = vi
      .fn()
      .mockResolvedValue({ error: { code: '42501', message: 'denied' } });
    const rpc = vi.fn();

    await expect(
      recordChatOrderSettlement({
        ...base,
        gatewayResponse: { status: 'success' },
        supabase: { from: vi.fn(() => ({ insert })), rpc } as never,
      })
    ).rejects.toThrow('paystack_settlement_collection_unknown');

    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to file chat-order settlement review',
        orderId: 'order-1',
        reference: 'CHAT-REF123',
        settlementError: 'paystack_settlement_collection_unknown',
      })
    );
  });

  it('fails closed and files a review when the verified split is for a different amount', async () => {
    const review = reviewTable();
    const rpc = vi.fn();

    await expect(
      recordChatOrderSettlement({
        ...base,
        gatewayResponse: {
          amount: 3_000_000,
          fees_split: {
            integration: 0,
            paystack: 37_500,
            subaccount: 2_962_500,
          },
          subaccount: { subaccount_code: 'ACCT_store' },
        },
        supabase: { from: review.from, rpc } as never,
      })
    ).rejects.toThrow('paystack_settlement_collection_inconsistent');
    expect(rpc).not.toHaveBeenCalled();
    expect(review.insert).toHaveBeenCalled();
  });
});
