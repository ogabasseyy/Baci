import { describe, expect, it } from 'vitest';
import { resolveChatOrderSettlementRouting } from '@/lib/payments/resolve-chat-order-settlement-routing';

describe('resolveChatOrderSettlementRouting', () => {
  it('marks a Baci-owned chat-order DVA payment as Baci-collected so it stays spendable', () => {
    // Arrange: Paystack shows no subaccount for a Baci-owned DVA.
    const args = {
      gateway: 'paystack',
      gatewayResponse: { fees_split: null, subaccount: {} },
    };

    // Act
    const routing = resolveChatOrderSettlementRouting(args);

    // Assert
    expect(routing).toEqual({
      extraMetadata: { paystack_collection: 'integration' },
      extraParams: {},
      rpc: 'record_merchant_settlement',
    });
  });

  it('records a subaccount-split chat payment as direct-settled history', () => {
    const routing = resolveChatOrderSettlementRouting({
      gateway: 'paystack',
      gatewayResponse: {
        amount: 1_000_000,
        fees_split: { integration: 0, paystack: 10_000, subaccount: 990_000 },
        subaccount: { subaccount_code: 'ACCT_chat' },
      },
    });

    expect(routing.rpc).toBe('record_paystack_direct_split_settlement');
    expect(routing.extraParams).toEqual({
      p_paystack_subaccount_code: 'ACCT_chat',
    });
  });

  it('fails closed without crediting when the payload proves nothing', () => {
    // Same rule as the main settlement path: an unprovable payload may be a
    // split the merchant's bank already received, so nothing is credited.
    expect(() =>
      resolveChatOrderSettlementRouting({
        gateway: 'paystack',
        gatewayResponse: { status: 'success' },
      })
    ).toThrow('paystack_settlement_collection_unknown');
  });

  it('leaves non-Paystack chat payments unchanged', () => {
    const routing = resolveChatOrderSettlementRouting({
      gateway: 'korapay',
      gatewayResponse: null,
    });

    expect(routing.rpc).toBe('record_merchant_settlement');
    expect(routing.extraMetadata).toEqual({});
  });
});
