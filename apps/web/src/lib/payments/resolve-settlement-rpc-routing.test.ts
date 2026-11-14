import { describe, expect, it } from 'vitest';
import { PERMANENT_PAID_ORDER_SIDE_EFFECT_ERRORS } from '@/lib/payments/paid-order-side-effect-retry-policy';
import {
  PAYSTACK_SETTLEMENT_COLLECTION_INCONSISTENT,
  PAYSTACK_SETTLEMENT_COLLECTION_UNKNOWN,
  resolveSettlementRpcRouting,
} from '@/lib/payments/resolve-settlement-rpc-routing';

// Production card shape: merchant + Baci + Paystack = amount.
const splitPayload = {
  amount: 27_752_088,
  fees_split: {
    integration: '5000',
    params: { transaction_charge: '205000' },
    paystack: 200_000,
    subaccount: 27547088,
  },
  subaccount: { subaccount_code: 'ACCT_merchant' },
};

describe('resolveSettlementRpcRouting', () => {
  it('routes a subaccount-split Paystack sale to the direct-split history recorder', () => {
    // Arrange
    const args = {
      gatewayResponse: splitPayload,
      isRedvaultDirectSettlement: false,
      settlementGateway: 'paystack' as const,
      useGiglSettlementRpc: false,
    };

    // Act
    const routing = resolveSettlementRpcRouting(args);

    // Assert
    expect(routing).toEqual({
      extraMetadata: {
        paystack_collection: 'direct_split',
        paystack_integration_share_kobo: 5000,
        paystack_subaccount_code: 'ACCT_merchant',
        paystack_subaccount_share_kobo: 27547088,
        paystack_transaction_charge_kobo: 205000,
      },
      extraParams: { p_paystack_subaccount_code: 'ACCT_merchant' },
      rpc: 'record_paystack_direct_split_settlement',
    });
  });

  it('uses the GIGL direct-split recorder for a GIGL order', () => {
    const routing = resolveSettlementRpcRouting({
      gatewayResponse: splitPayload,
      isRedvaultDirectSettlement: false,
      settlementGateway: 'paystack',
      useGiglSettlementRpc: true,
    });

    expect(routing.rpc).toBe('record_paystack_direct_split_settlement_gigl_v1');
  });

  it('keeps crediting the wallet, marked as Baci-collected, when Paystack shows no subaccount', () => {
    const routing = resolveSettlementRpcRouting({
      gatewayResponse: { fees_split: null, subaccount: {} },
      isRedvaultDirectSettlement: false,
      settlementGateway: 'paystack',
      useGiglSettlementRpc: false,
    });

    expect(routing).toEqual({
      extraMetadata: { paystack_collection: 'integration' },
      extraParams: {},
      rpc: 'record_merchant_settlement',
    });
  });

  it('throws before any routing when the Paystack payload cannot prove where the money went', () => {
    expect(() =>
      resolveSettlementRpcRouting({
        gatewayResponse: { status: 'success' },
        isRedvaultDirectSettlement: false,
        settlementGateway: 'paystack',
        useGiglSettlementRpc: false,
      })
    ).toThrow(PAYSTACK_SETTLEMENT_COLLECTION_UNKNOWN);
  });

  it('keeps an unprovable Paystack collection retryable so the drain can re-verify it', () => {
    // The drain fetches a fresh Paystack payload for a stored one that lacks
    // the split fields, so retrying can classify the sale.
    expect(PERMANENT_PAID_ORDER_SIDE_EFFECT_ERRORS).not.toContain(
      PAYSTACK_SETTLEMENT_COLLECTION_UNKNOWN
    );
  });

  it("treats a split to a subaccount that is not the merchant's as permanent", () => {
    // The direct-split recorder raises this when the payload's subaccount is
    // not the merchant's registered one; retries cannot change either side.
    expect(PERMANENT_PAID_ORDER_SIDE_EFFECT_ERRORS).toContain(
      'paystack_direct_settlement_subaccount_mismatch'
    );
  });

  it('fails permanently when the split fields are present but provably inconsistent', () => {
    // Re-verifying the same transaction cannot change a contradiction, so it
    // must not burn retries: it is a permanent error for manual review.
    for (const gatewayResponse of [
      { fees_split: {}, subaccount: {} },
      { ...splitPayload, amount: 1 },
      { fees_split: { subaccount: 990_000 }, subaccount: {} },
    ]) {
      expect(() =>
        resolveSettlementRpcRouting({
          gatewayResponse,
          isRedvaultDirectSettlement: false,
          settlementGateway: 'paystack',
          useGiglSettlementRpc: false,
        })
      ).toThrow(PAYSTACK_SETTLEMENT_COLLECTION_INCONSISTENT);
    }
    expect(PERMANENT_PAID_ORDER_SIDE_EFFECT_ERRORS).toContain(
      PAYSTACK_SETTLEMENT_COLLECTION_INCONSISTENT
    );
  });

  it('fails permanently when a verified split is for a different amount than the sale', () => {
    expect(() =>
      resolveSettlementRpcRouting({
        grossAmountKobo: 1_000,
        gatewayResponse: splitPayload,
        isRedvaultDirectSettlement: false,
        settlementGateway: 'paystack',
        useGiglSettlementRpc: false,
      })
    ).toThrow(PAYSTACK_SETTLEMENT_COLLECTION_INCONSISTENT);
  });

  it('keeps REDVAULT on its own recorder even when a subaccount is present', () => {
    const routing = resolveSettlementRpcRouting({
      gatewayResponse: splitPayload,
      isRedvaultDirectSettlement: true,
      settlementGateway: 'paystack',
      useGiglSettlementRpc: true,
    });

    expect(routing.rpc).toBe('record_uba_redvault_direct_settlement_gigl_v1');
    expect(routing.extraParams).toEqual({});
  });

  it('leaves Korapay on the wallet-crediting recorder without inspecting the payload', () => {
    const routing = resolveSettlementRpcRouting({
      gatewayResponse: null,
      isRedvaultDirectSettlement: false,
      settlementGateway: 'korapay',
      useGiglSettlementRpc: false,
    });

    expect(routing.rpc).toBe('record_merchant_settlement');
  });
});
