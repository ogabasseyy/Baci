import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StepContext } from '@/lib/payments/apply-paid-order-side-effects';
import { buildSettlementExecutor } from '@/lib/payments/paid-order-settlement-executor';
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

describe('buildSettlementExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calculatePlatformFee.mockReturnValue({ platformFee: 12_345 });
    mocks.extractVerifiedGatewayFeeNgn.mockReturnValue(300);
  });

  it('records a merchant settlement with explicit platform and allocated gateway fees', async () => {
    const { rpc, supabase } = createSupabase();
    const result = await buildSettlementExecutor({
      allocatedGatewayFeeNgn: 250,
      externalGatewayReference: 'PSK_REF_1',
      settlementGateway: 'paystack',
      supabase,
      transaction: { ...transaction, platform_fee: 99.5 },
    })(stepContext);

    expect(result).toEqual({
      gateway_fee: 250,
      gross_amount: 20_000,
      platform_fee: 99.5,
    });
    expect(mocks.extractVerifiedGatewayFeeNgn).not.toHaveBeenCalled();
    expect(mocks.calculatePlatformFee).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('record_merchant_settlement', {
      p_description: 'Order payment via paystack',
      p_gateway: 'paystack',
      p_gateway_fee: 250,
      p_gateway_reference: 'PSK_REF_1',
      p_gross_amount: 20_000,
      p_merchant_id: 'merchant-1',
      p_metadata: {
        paystack_reference: 'PSK_REF_1',
        verified_gateway_fee: 250,
      },
      p_platform_fee: 99.5,
      p_source_id: 'order-1',
      p_source_type: 'order',
    });
  });

  it('routes REDVAULT split sales through the wallet-free direct settlement RPC', async () => {
    const { rpc, supabase } = createSupabase();
    const result = await buildSettlementExecutor({
      allocatedGatewayFeeNgn: 250,
      externalGatewayReference: 'PSK_REF_RV',
      orderPaymentMethod: 'uba_redvault',
      settlementGateway: 'paystack',
      supabase,
      transaction: { ...transaction, platform_fee: 99.5 },
    })(stepContext);

    expect(result).toEqual({
      gateway_fee: 250,
      gross_amount: 20_000,
      platform_fee: 99.5,
    });
    expect(rpc).toHaveBeenCalledWith(
      'record_uba_redvault_direct_settlement',
      expect.objectContaining({
        p_gateway: 'paystack',
        p_gateway_reference: 'PSK_REF_RV',
        p_gross_amount: 20_000,
        p_source_id: 'order-1',
        p_source_type: 'order',
      })
    );
  });

  it('routes REDVAULT GIGL orders through the direct-split GIGL RPC', async () => {
    const { rpc, supabase } = createSupabase();
    const maybeSingle = vi.fn(async () => ({
      data: { metadata: { retained_shipping_amount: 200 } },
      error: null,
    }));
    const chain = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle,
      neq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
    };
    const giglSupabase = {
      ...supabase,
      from: vi.fn(() => chain),
    } as unknown as ServiceRoleClient;
    const result = await buildSettlementExecutor({
      allocatedGatewayFeeNgn: 250,
      externalGatewayReference: 'PSK_REF_RV_GIGL',
      orderPaymentMethod: 'uba_redvault',
      orderShippingFundingSource: 'customer_checkout',
      orderShippingProvider: 'GIGL',
      orderShippingRetainedAmount: 200,
      settlementGateway: 'paystack',
      supabase: giglSupabase,
      transaction: { ...transaction, platform_fee: 99.5 },
    })(stepContext);

    expect(result).toEqual({
      commerce_platform_fee: 99.5,
      gateway_fee: 250,
      gross_amount: 20_000,
      platform_fee: 99.5,
      retained_shipping_amount: 200,
    });
    expect(rpc).toHaveBeenCalledWith(
      'record_uba_redvault_direct_settlement_gigl_v1',
      expect.objectContaining({
        p_gateway_reference: 'PSK_REF_RV_GIGL',
        p_platform_fee: 99.5,
        p_source_id: 'order-1',
        p_source_type: 'order',
      })
    );
  });

  it('keeps the standard settlement RPC for non-REDVAULT methods', async () => {
    const { rpc, supabase } = createSupabase();
    await buildSettlementExecutor({
      allocatedGatewayFeeNgn: 250,
      externalGatewayReference: 'PSK_REF_CARD',
      orderPaymentMethod: 'card',
      settlementGateway: 'paystack',
      supabase,
      transaction: { ...transaction, platform_fee: 99.5 },
    })(stepContext);

    expect(rpc).toHaveBeenCalledWith(
      'record_merchant_settlement',
      expect.objectContaining({ p_gateway_reference: 'PSK_REF_CARD' })
    );
  });

  it('allows replay to be delegated to the idempotent settlement RPC', async () => {
    const { rpc, supabase } = createSupabase();
    const executor = buildSettlementExecutor({
      allocatedGatewayFeeNgn: 250,
      externalGatewayReference: 'PSK_REF_1',
      settlementGateway: 'paystack',
      supabase,
      transaction,
    });

    await expect(executor(stepContext)).resolves.toMatchObject({
      gateway_fee: 250,
      gross_amount: 20_000,
    });
    await expect(executor(stepContext)).resolves.toMatchObject({
      gateway_fee: 250,
      gross_amount: 20_000,
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'record_merchant_settlement',
      expect.objectContaining({
        p_gateway_reference: 'PSK_REF_1',
        p_source_id: 'order-1',
        p_source_type: 'order',
      })
    );
  });

  it('falls back to verified gateway fees and calculated platform fees', async () => {
    const { supabase } = createSupabase();
    const result = await buildSettlementExecutor({
      externalGatewayReference: 'PSK_REF_1',
      settlementGateway: 'paystack',
      supabase,
      transaction: { ...transaction, gateway_reference: null },
    })(stepContext);

    expect(result).toMatchObject({ gateway_fee: 300, platform_fee: 123.45 });
    expect(mocks.extractVerifiedGatewayFeeNgn).toHaveBeenCalledWith(
      'paystack',
      stepContext.gatewayResponse
    );
    expect(mocks.calculatePlatformFee).toHaveBeenCalledWith(2_000_000);
  });

  it('rejects invalid arguments before any settlement RPC runs', () => {
    const { rpc, supabase } = createSupabase();

    expect(() =>
      buildSettlementExecutor({
        externalGatewayReference: 'PSK_REF_1',
        settlementGateway: 'paystack',
        supabase,
        transaction: { ...transaction, merchant_id: '' },
      })
    ).toThrow('invalid_settlement_executor_args');
    expect(() =>
      buildSettlementExecutor({
        externalGatewayReference: 'PSK_REF_1',
        settlementGateway: 'paystack',
        supabase,
        transaction: { ...transaction, amount: '1e5' },
      })
    ).toThrow('invalid_settlement_executor_args');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects non-positive gross amounts and invalid gateway fees', async () => {
    const { supabase } = createSupabase();

    await expect(
      buildSettlementExecutor({
        externalGatewayReference: 'PSK_REF_1',
        settlementGateway: 'paystack',
        supabase,
        transaction: { ...transaction, amount: 0 },
      })(stepContext)
    ).rejects.toThrow('Settlement amount must be positive');
    expect(() =>
      buildSettlementExecutor({
        externalGatewayReference: 'PSK_REF_1',
        settlementGateway: 'paystack',
        supabase,
        transaction: { ...transaction, amount: -1 },
      })
    ).toThrow('invalid_settlement_executor_args');

    mocks.extractVerifiedGatewayFeeNgn.mockReturnValueOnce(
      Number.POSITIVE_INFINITY
    );
    await expect(
      buildSettlementExecutor({
        externalGatewayReference: 'PSK_REF_1',
        settlementGateway: 'paystack',
        supabase,
        transaction,
      })(stepContext)
    ).rejects.toThrow('Invalid gateway fee');
  });

  it('rejects invalid platform fees and fees larger than the gross amount', async () => {
    const { rpc, supabase } = createSupabase();

    expect(() =>
      buildSettlementExecutor({
        allocatedGatewayFeeNgn: 10,
        externalGatewayReference: 'PSK_REF_1',
        settlementGateway: 'paystack',
        supabase,
        transaction: { ...transaction, platform_fee: -1 },
      })
    ).toThrow('invalid_settlement_executor_args');

    await expect(
      buildSettlementExecutor({
        allocatedGatewayFeeNgn: 19_999.99,
        externalGatewayReference: 'PSK_REF_1',
        settlementGateway: 'paystack',
        supabase,
        transaction: { ...transaction, platform_fee: 0.02 },
      })(stepContext)
    ).rejects.toThrow(
      'Settlement fees exceed gross amount: gatewayFee=19999.99, platformFee=0.02, grossAmount=20000'
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calculates fallback platform fees from unrounded gross kobo', async () => {
    const { rpc, supabase } = createSupabase();
    mocks.calculatePlatformFee.mockReturnValueOnce({ platformFee: 123.4 });

    const result = await buildSettlementExecutor({
      allocatedGatewayFeeNgn: 0.03,
      externalGatewayReference: 'PSK_REF_1',
      settlementGateway: 'paystack',
      supabase,
      transaction: { ...transaction, amount: 12.345, platform_fee: null },
    })(stepContext);

    expect(result).toMatchObject({
      gateway_fee: 0.03,
      gross_amount: 12.35,
      platform_fee: 1.23,
    });
    expect(mocks.calculatePlatformFee).toHaveBeenCalledWith(1234.5);
    expect(rpc).toHaveBeenCalledWith(
      'record_merchant_settlement',
      expect.objectContaining({
        p_gross_amount: 12.35,
      })
    );
  });

  it('throws when the settlement RPC fails', async () => {
    const { supabase } = createSupabase({ message: 'rpc failed' });

    await expect(
      buildSettlementExecutor({
        externalGatewayReference: 'PSK_REF_1',
        settlementGateway: 'paystack',
        supabase,
        transaction,
      })(stepContext)
    ).rejects.toThrow('rpc failed');
  });
});
