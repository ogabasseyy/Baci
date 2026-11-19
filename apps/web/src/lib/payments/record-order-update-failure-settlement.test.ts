import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordOrderUpdateFailureSettlement } from './record-order-update-failure-settlement';

const extractVerifiedGatewayFeeNgn = vi.hoisted(() => vi.fn(() => 50));
const calculatePlatformFee = vi.hoisted(() =>
  vi.fn(() => ({ platformFee: 1500 }))
);
const resolveOrderGiglSettlementRpc = vi.hoisted(() =>
  vi.fn(
    (): {
      hasEconomicsSnapshot: boolean;
      retainedShippingAmount: number;
      settlementRpc:
        | 'record_merchant_settlement_gigl_v1'
        | 'record_merchant_settlement';
      useGiglSettlementRpc: boolean;
    } => ({
      hasEconomicsSnapshot: true,
      retainedShippingAmount: 1200,
      settlementRpc: 'record_merchant_settlement_gigl_v1',
      useGiglSettlementRpc: true,
    })
  )
);

vi.mock('@/lib/payments/verified-gateway-fee', () => ({
  extractVerifiedGatewayFeeNgn,
}));
vi.mock('@/lib/paystack', () => ({
  calculatePlatformFee,
}));
vi.mock('@/lib/payments/resolve-order-gigl-settlement-rpc', () => ({
  resolveOrderGiglSettlementRpc,
}));

describe('recordOrderUpdateFailureSettlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveOrderGiglSettlementRpc.mockReturnValue({
      hasEconomicsSnapshot: true,
      retainedShippingAmount: 1200,
      settlementRpc: 'record_merchant_settlement_gigl_v1',
      useGiglSettlementRpc: true,
    });
  });

  it('records GIGL settlement with retained shipping when order economics load', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        shipping_funding_source: 'customer_checkout',
        shipping_platform_retained_amount: 1200,
        shipping_provider: 'GIGL',
      },
      error: null,
    });
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      })),
      rpc,
    };

    await expect(
      recordOrderUpdateFailureSettlement({
        gateway: 'korapay',
        gatewayReference: 'BAC-1',
        gatewayResponse: { fee: 50 },
        grossAmount: 10000,
        merchantId: 'merchant-1',
        orderId: 'order-1',
        platformFee: 15,
        reference: 'REF-1',
        supabase: supabase as never,
      })
    ).resolves.toEqual({ kind: 'recorded' });

    expect(resolveOrderGiglSettlementRpc).toHaveBeenCalledWith({
      shipping_funding_source: 'customer_checkout',
      shipping_platform_retained_amount: 1200,
      shipping_provider: 'GIGL',
    });
    expect(rpc).toHaveBeenCalledWith(
      'record_merchant_settlement_gigl_v1',
      expect.objectContaining({
        p_gateway_reference: 'BAC-1',
        p_metadata: expect.objectContaining({
          korapay_reference: 'REF-1',
          order_update_failed: true,
          retained_shipping_amount: 1200,
        }),
        p_source_id: 'order-1',
      })
    );
  });

  it('fails closed when order economics lookup errors', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'timeout' },
    });
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      })),
      rpc: vi.fn(),
    };

    await expect(
      recordOrderUpdateFailureSettlement({
        gateway: 'korapay',
        gatewayReference: 'BAC-1',
        gatewayResponse: {},
        grossAmount: 10000,
        merchantId: 'merchant-1',
        orderId: 'order-1',
        platformFee: null,
        reference: 'REF-1',
        supabase: supabase as never,
      })
    ).resolves.toEqual({
      kind: 'economics_load_failed',
      error: { message: 'timeout' },
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('returns settlement_failed when the settlement RPC errors', async () => {
    resolveOrderGiglSettlementRpc.mockReturnValue({
      hasEconomicsSnapshot: false,
      retainedShippingAmount: 0,
      settlementRpc: 'record_merchant_settlement',
      useGiglSettlementRpc: false,
    });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'rpc failed' },
    });
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      })),
      rpc,
    };

    await expect(
      recordOrderUpdateFailureSettlement({
        gateway: 'paystack',
        gatewayReference: null,
        // Baci-collected payload, so routing reaches the failing RPC.
        gatewayResponse: { fees_split: null, subaccount: {} },
        grossAmount: 5000,
        merchantId: 'merchant-1',
        orderId: 'order-2',
        platformFee: 0,
        reference: 'REF-2',
        supabase: supabase as never,
      })
    ).resolves.toEqual({
      kind: 'settlement_failed',
      error: { message: 'rpc failed' },
    });
  });
});

describe('bugfix: the order-update-failure fallback credited Paystack split sales to the wallet', () => {
  const split = {
    amount: 1_000_000,
    fees_split: { integration: 5_000, paystack: 15_000, subaccount: 980_000 },
    subaccount: { subaccount_code: 'ACCT_store' },
  };

  function supabaseWith() {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        shipping_funding_source: 'customer_checkout',
        shipping_platform_retained_amount: 1200,
        shipping_provider: 'GIGL',
      },
      error: null,
    });
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
      })),
      rpc,
    };
    return { rpc, supabase };
  }

  function run(supabase: unknown, gatewayResponse: unknown) {
    return recordOrderUpdateFailureSettlement({
      gateway: 'paystack',
      gatewayReference: 'BAC-1',
      gatewayResponse,
      grossAmount: 10000,
      merchantId: 'merchant-1',
      orderId: 'order-1',
      platformFee: 15,
      reference: 'REF-1',
      supabase: supabase as never,
    });
  }

  beforeEach(() => {
    resolveOrderGiglSettlementRpc.mockReturnValue({
      hasEconomicsSnapshot: true,
      retainedShippingAmount: 1200,
      settlementRpc: 'record_merchant_settlement_gigl_v1',
      useGiglSettlementRpc: true,
    });
  });

  it('records a verified Paystack split as direct-settled history, not a wallet credit', async () => {
    const { rpc, supabase } = supabaseWith();

    await expect(run(supabase, split)).resolves.toEqual({ kind: 'recorded' });

    expect(rpc).toHaveBeenCalledWith(
      'record_paystack_direct_split_settlement_gigl_v1',
      expect.objectContaining({
        p_metadata: expect.objectContaining({
          order_update_failed: true,
          paystack_collection: 'direct_split',
        }),
        p_paystack_subaccount_code: 'ACCT_store',
      })
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'record_merchant_settlement_gigl_v1',
      expect.anything()
    );
  });

  it('marks a Baci-collected Paystack payment so its credit stays spendable', async () => {
    const { rpc, supabase } = supabaseWith();

    await run(supabase, { fees_split: null, subaccount: {} });

    expect(rpc).toHaveBeenCalledWith(
      'record_merchant_settlement_gigl_v1',
      expect.objectContaining({
        p_metadata: expect.objectContaining({
          paystack_collection: 'integration',
        }),
      })
    );
  });

  it('fails closed without crediting when the Paystack payload proves neither', async () => {
    const { rpc, supabase } = supabaseWith();

    const result = await run(supabase, { status: 'success' });

    expect(result).toEqual({
      kind: 'settlement_failed',
      error: expect.objectContaining({
        message: 'paystack_settlement_collection_unknown',
      }),
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails closed when the verified split is for a different amount than this sale', async () => {
    const { rpc, supabase } = supabaseWith();

    // A consistent split, but for ₦25,000 rather than this ₦10,000 sale.
    const result = await run(supabase, {
      ...split,
      amount: 2_500_000,
      fees_split: { ...split.fees_split, subaccount: 2_480_000 },
    });

    expect(result).toEqual({
      kind: 'settlement_failed',
      error: expect.objectContaining({
        message: 'paystack_settlement_collection_inconsistent',
      }),
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
