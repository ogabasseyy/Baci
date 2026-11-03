import { describe, expect, it } from 'vitest';
import { resolveChatOrderSettlementRouting } from '@/lib/payments/resolve-chat-order-settlement-routing';

describe('resolveChatOrderSettlementRouting', () => {
  it('marks a Baci-owned chat-order DVA payment as Baci-collected so it stays spendable', () => {
    // Arrange: Paystack shows no subaccount for a Baci-owned DVA.
    const args = { gateway: 'paystack', gatewayResponse: { subaccount: {} } };

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
        fees_split: { subaccount: 990_000 },
        subaccount: { subaccount_code: 'ACCT_chat' },
      },
    });

    expect(routing.rpc).toBe('record_paystack_direct_split_settlement');
    expect(routing.extraParams).toEqual({
      p_paystack_subaccount_code: 'ACCT_chat',
    });
  });

  it('keeps the unmarked wallet credit when the payload proves nothing', () => {
    const routing = resolveChatOrderSettlementRouting({
      gateway: 'paystack',
      gatewayResponse: { status: 'success' },
    });

    expect(routing).toEqual({
      extraMetadata: {},
      extraParams: {},
      rpc: 'record_merchant_settlement',
    });
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
