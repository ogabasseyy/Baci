import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/payments/juicyway-platform-fee', () => ({
  calculateJuicywayPlatformFee: vi.fn(() => 50),
}));

vi.mock('@/lib/payments/resolve-order-gigl-settlement-rpc', () => ({
  resolveOrderGiglSettlementRpc: vi.fn(() => ({
    settlementRpc: 'record_gigl_merchant_settlement',
    hasEconomicsSnapshot: true,
    retainedShippingAmount: 2500,
  })),
}));

import { calculateJuicywayPlatformFee } from '@/lib/payments/juicyway-platform-fee';
import { resolveOrderGiglSettlementRpc } from '@/lib/payments/resolve-order-gigl-settlement-rpc';
import { recordJuicywayOrderSettlement } from './record-juicyway-order-settlement';

describe('recordJuicywayOrderSettlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads order economics and records GIGL settlement metadata', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        shipping_provider: 'GIGL',
        shipping_funding_source: 'customer_checkout',
        shipping_platform_retained_amount: 2500,
      },
      error: null,
    });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      })),
      rpc,
    };

    await expect(
      recordJuicywayOrderSettlement(
        supabase as never,
        {
          amount: 10_000,
          merchant_id: 'merchant-1',
          order_id: 'order-1',
          platform_fee: null,
        },
        'jw-ref-1'
      )
    ).resolves.toBe(true);

    expect(calculateJuicywayPlatformFee).toHaveBeenCalledWith(10_000);
    expect(resolveOrderGiglSettlementRpc).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      'record_gigl_merchant_settlement',
      expect.objectContaining({
        p_gateway: 'juicyway',
        p_gateway_reference: 'jw-ref-1',
        p_metadata: expect.objectContaining({
          retained_shipping_amount: 2500,
          commerce_platform_fee: 50,
        }),
      })
    );
  });

  it('returns false when order economics cannot be loaded', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'boom' },
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
      recordJuicywayOrderSettlement(
        supabase as never,
        {
          amount: 10_000,
          merchant_id: 'merchant-1',
          order_id: 'order-1',
          platform_fee: 40,
        },
        'jw-ref-2'
      )
    ).resolves.toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
