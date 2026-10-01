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
        gatewayResponse: {},
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
