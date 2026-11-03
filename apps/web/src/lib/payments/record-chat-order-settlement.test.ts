import { describe, expect, it, vi } from 'vitest';
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
    // Arrange
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: 'settlement-1', error: null });

    // Act
    await recordChatOrderSettlement({
      ...base,
      gatewayResponse: { subaccount: {} },
      supabase: { rpc },
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
        supabase: { rpc },
      })
    ).rejects.toThrow(
      'chat_order_settlement_failed: record_paystack_direct_split_settlement: paystack_direct_settlement_subaccount_mismatch'
    );
  });

  it('records nothing when the Paystack payload proves neither collection mode', async () => {
    const rpc = vi.fn();

    await expect(
      recordChatOrderSettlement({
        ...base,
        gatewayResponse: { status: 'success' },
        supabase: { rpc },
      })
    ).rejects.toThrow('paystack_settlement_collection_unknown');
    expect(rpc).not.toHaveBeenCalled();
  });
});
