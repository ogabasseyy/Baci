import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StepContext } from '@/lib/payments/apply-paid-order-side-effects';
import { buildSettlementExecutor } from '@/lib/payments/paid-order-settlement-executor';
import { PERMANENT_PAID_ORDER_SIDE_EFFECT_ERRORS } from '@/lib/payments/paid-order-side-effect-retry-policy';
import type {
  PaidOrderSideEffectTransaction,
  ServiceRoleClient,
} from '@/lib/payments/paid-order-side-effect-types';

const mocks = vi.hoisted(() => ({
  calculatePlatformFee: vi.fn(() => ({ platformFee: 12_345 })),
  extractVerifiedGatewayFeeNgn: vi.fn(() => 300),
}));

vi.mock('@/lib/payments/verified-gateway-fee', () => ({
  extractVerifiedGatewayFeeNgn: mocks.extractVerifiedGatewayFeeNgn,
}));

vi.mock('@/lib/paystack', () => ({
  calculatePlatformFee: mocks.calculatePlatformFee,
}));

const transaction: PaidOrderSideEffectTransaction = {
  amount: 20_000,
  gateway_reference: 'WALLET-DVA-ORDER-order-1',
  id: 'txn-order-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
};

const stepContext: StepContext = {
  consistency: { consistent: true },
  gatewayResponse: { fees: 30_000 },
  order: {
    discount_amount: 0,
    gift_wrapping_fee: 0,
    id: 'order-1',
    merchant_id: 'merchant-1',
    payment_status: 'paid',
    shipping_fee: 0,
    subtotal: 20_000,
    tax_amount: 0,
    tax_basis: 'exclusive',
    total: 20_000,
  },
  transaction,
};

function createSupabase(error: { message: string } | null = null) {
  const rpc = vi.fn(async () => ({ data: null, error }));
  return {
    rpc,
    supabase: { rpc } as unknown as ServiceRoleClient,
  };
}

describe('buildSettlementExecutor cancelled-order guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calculatePlatformFee.mockReturnValue({ platformFee: 12_345 });
    mocks.extractVerifiedGatewayFeeNgn.mockReturnValue(300);
  });

  it('normalizes the settlement RPC cancelled-order guard to its permanent code', async () => {
    const { supabase } = createSupabase({
      message: 'settlement_order_cancelled',
    });

    await expect(
      buildSettlementExecutor({
        allocatedGatewayFeeNgn: 250,
        externalGatewayReference: 'PSK_REF_1',
        settlementGateway: 'paystack',
        supabase,
        transaction: { ...transaction, platform_fee: 99.5 },
      })(stepContext)
    ).rejects.toThrow('settlement_order_cancelled');
  });

  it('pins the normalized code to the permanent-error filter list', async () => {
    const { supabase } = createSupabase({
      message: 'record_merchant_settlement: settlement_order_cancelled',
    });

    const failure = await buildSettlementExecutor({
      allocatedGatewayFeeNgn: 250,
      externalGatewayReference: 'PSK_REF_1',
      settlementGateway: 'paystack',
      supabase,
      transaction: { ...transaction, platform_fee: 99.5 },
    })(stepContext).then(
      () => {
        throw new Error('expected the executor to throw');
      },
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(Error);
    expect(
      (PERMANENT_PAID_ORDER_SIDE_EFFECT_ERRORS as readonly string[]).includes(
        (failure as Error).message
      )
    ).toBe(true);
  });

  it('rethrows non-guard RPC errors unchanged', async () => {
    const { supabase } = createSupabase({ message: 'connection reset' });

    await expect(
      buildSettlementExecutor({
        allocatedGatewayFeeNgn: 250,
        externalGatewayReference: 'PSK_REF_1',
        settlementGateway: 'paystack',
        supabase,
        transaction: { ...transaction, platform_fee: 99.5 },
      })(stepContext)
    ).rejects.toThrow('connection reset');
  });
});
