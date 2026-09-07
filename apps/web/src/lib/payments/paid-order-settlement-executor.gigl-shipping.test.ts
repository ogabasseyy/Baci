import { describe, expect, it, vi } from 'vitest';
import type { StepContext } from '@/lib/payments/apply-paid-order-side-effects';
import { buildSettlementExecutor } from '@/lib/payments/paid-order-settlement-executor';
import type { ServiceRoleClient } from '@/lib/payments/paid-order-side-effect-types';

const transaction = {
  amount: 100_000,
  gateway_reference: 'REF',
  id: 'txn',
  merchant_id: 'm',
  order_id: 'o',
};
const context: StepContext = {
  consistency: { consistent: true },
  gatewayResponse: { fees: 0 },
  transaction,
  order: {
    discount_amount: 0,
    gift_wrapping_fee: 0,
    id: 'o',
    merchant_id: 'm',
    payment_status: 'paid',
    shipping_fee: 11_000,
    subtotal: 89_000,
    tax_amount: 0,
    tax_basis: 'exclusive',
    total: 100_000,
  },
};

function setup(actualRetainedShippingAmount = 11_000) {
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  const maybeSingle = vi.fn(async () => ({
    data: {
      metadata: { retained_shipping_amount: actualRetainedShippingAmount },
    },
    error: null,
  }));
  const neqStatus = vi.fn(() => ({ maybeSingle }));
  const eqSourceId = vi.fn(() => ({ neq: neqStatus }));
  const eqSourceType = vi.fn(() => ({ eq: eqSourceId }));
  const eqGatewayReference = vi.fn(() => ({ eq: eqSourceType }));
  const eqGateway = vi.fn(() => ({ eq: eqGatewayReference }));
  const select = vi.fn(() => ({ eq: eqGateway }));
  const from = vi.fn((table: string) => {
    if (table === 'merchant_settlements') {
      return { select };
    }
    return { select: vi.fn(() => ({ eq: vi.fn() })) };
  });

  return {
    from,
    rpc,
    supabase: { from, rpc } as unknown as ServiceRoleClient,
  };
}

describe('GIGL shipping settlement retention', () => {
  it('retains customer checkout shipping exactly once and separates metadata', async () => {
    const { rpc, supabase } = setup();
    const result = await buildSettlementExecutor({
      externalGatewayReference: 'REF',
      settlementGateway: 'paystack',
      supabase,
      transaction: { ...transaction, platform_fee: 1_000 },
      orderShippingProvider: 'GIGL',
      orderShippingFundingSource: 'customer_checkout',
      orderShippingRetainedAmount: 11_000,
    })(context);
    expect(result).toMatchObject({
      commerce_platform_fee: 1_000,
      retained_shipping_amount: 11_000,
      platform_fee: 1_000,
    });
    expect(rpc).toHaveBeenCalledWith(
      'record_merchant_settlement_gigl_v1',
      expect.objectContaining({
        p_platform_fee: 1_000,
        p_metadata: expect.objectContaining({
          commerce_platform_fee: 1_000,
          retained_shipping_amount: 11_000,
        }),
      })
    );
  });

  it.each([
    ['merchant_wallet', 0],
  ] as const)('retains zero shipping for %s funding', async (source, retained) => {
    const { rpc, supabase } = setup();
    await buildSettlementExecutor({
      externalGatewayReference: 'REF',
      settlementGateway: 'paystack',
      supabase,
      transaction: { ...transaction, platform_fee: 1_000 },
      orderShippingProvider: 'GIGL',
      orderShippingFundingSource: source,
      orderShippingRetainedAmount: 11_000,
    })(context);
    expect(rpc).toHaveBeenCalledWith(
      'record_merchant_settlement_gigl_v1',
      expect.objectContaining({
        p_platform_fee: 1_000,
        p_metadata: expect.objectContaining({
          retained_shipping_amount: retained,
        }),
      })
    );
  });

  it.each([
    null,
    undefined,
  ] as const)('fails closed when %s funding source has positive retained shipping', async (source) => {
    const { rpc, supabase } = setup();
    await expect(
      buildSettlementExecutor({
        externalGatewayReference: 'REF',
        settlementGateway: 'paystack',
        supabase,
        transaction: { ...transaction, platform_fee: 1_000 },
        ...(source === undefined ? {} : { orderShippingFundingSource: source }),
        orderShippingRetainedAmount: 11_000,
      })(context)
    ).rejects.toThrow('Invalid retained shipping snapshot');
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    null,
    undefined,
  ] as const)('preserves legacy settlement when %s funding source has no retained amount', async (source) => {
    const { rpc, supabase } = setup();
    const result = await buildSettlementExecutor({
      externalGatewayReference: 'REF',
      settlementGateway: 'paystack',
      supabase,
      transaction: { ...transaction, platform_fee: 1_000 },
      ...(source === undefined ? {} : { orderShippingFundingSource: source }),
      orderShippingRetainedAmount: source === null ? null : 0,
    })(context);
    expect(result).toEqual({
      gateway_fee: 0,
      gross_amount: 100_000,
      platform_fee: 1_000,
    });
    expect(rpc).toHaveBeenCalledWith(
      'record_merchant_settlement',
      expect.objectContaining({
        p_platform_fee: 1_000,
        p_metadata: expect.not.objectContaining({
          commerce_platform_fee: expect.anything(),
          retained_shipping_amount: expect.anything(),
        }),
      })
    );
  });

  it('fails closed when retained shipping makes fees exceed verified gross', async () => {
    const { rpc, supabase } = setup();
    await expect(
      buildSettlementExecutor({
        externalGatewayReference: 'REF',
        settlementGateway: 'paystack',
        supabase,
        transaction: { ...transaction, amount: 100, platform_fee: 90 },
        orderShippingFundingSource: 'customer_checkout',
        orderShippingRetainedAmount: 20,
      })(context)
    ).rejects.toThrow('Settlement fees exceed gross amount');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns the authoritative retained amount recorded by the GIGL wrapper', async () => {
    const { rpc, supabase } = setup(9_500);
    const result = await buildSettlementExecutor({
      externalGatewayReference: 'REF',
      settlementGateway: 'paystack',
      supabase,
      transaction: { ...transaction, platform_fee: 1_000 },
      orderShippingProvider: 'GIGL',
      orderShippingFundingSource: 'customer_checkout',
      orderShippingRetainedAmount: 11_000,
    })(context);

    expect(result?.retained_shipping_amount).toBe(9_500);
    expect(rpc).toHaveBeenCalledWith(
      'record_merchant_settlement_gigl_v1',
      expect.objectContaining({
        p_metadata: expect.objectContaining({
          retained_shipping_amount: 11_000,
        }),
      })
    );
  });
});
