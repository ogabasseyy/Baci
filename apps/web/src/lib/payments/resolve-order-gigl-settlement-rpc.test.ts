import { describe, expect, it } from 'vitest';
import { resolveOrderGiglSettlementRpc } from './resolve-order-gigl-settlement-rpc';

describe('resolveOrderGiglSettlementRpc', () => {
  it('routes customer-checkout GIGL orders through the GIGL retention RPC', () => {
    expect(
      resolveOrderGiglSettlementRpc({
        shipping_funding_source: 'customer_checkout',
        shipping_platform_retained_amount: 1500,
        shipping_provider: 'GIGL',
      })
    ).toEqual({
      hasEconomicsSnapshot: true,
      retainedShippingAmount: 1500,
      settlementRpc: 'record_merchant_settlement_gigl_v1',
      useGiglSettlementRpc: true,
    });
  });

  it('keeps non-GIGL orders on the legacy settlement RPC', () => {
    expect(
      resolveOrderGiglSettlementRpc({
        shipping_funding_source: null,
        shipping_platform_retained_amount: 0,
        shipping_provider: 'TOPSHIP',
      })
    ).toMatchObject({
      settlementRpc: 'record_merchant_settlement',
      useGiglSettlementRpc: false,
    });
  });
});
