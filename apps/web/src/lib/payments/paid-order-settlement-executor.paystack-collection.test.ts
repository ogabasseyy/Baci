import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StepContext } from '@/lib/payments/apply-paid-order-side-effects';
import { buildSettlementExecutor } from '@/lib/payments/paid-order-settlement-executor';
import type { ServiceRoleClient } from '@/lib/payments/paid-order-side-effect-types';

const transaction = {
  amount: 20_000,
  gateway_reference: 'REF',
  id: 'txn',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
  platform_fee: 99.5,
};

function contextWith(gatewayResponse: Record<string, unknown>): StepContext {
  return {
    consistency: { consistent: true },
    gatewayResponse,
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
}

const splitResponse = {
  amount: 2_000_000,
  fees_split: {
    integration: '5000',
    params: { bearer: 'account', transaction_charge: '205000' },
    paystack: 30_000,
    subaccount: 1_965_000,
  },
  subaccount: { subaccount_code: 'ACCT_merchant1' },
};

function setup() {
  const rpc = vi.fn(async () => ({ data: null, error: null }));
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
  const from = vi.fn(() => chain);
  return { from, rpc, supabase: { from, rpc } as unknown as ServiceRoleClient };
}

const baseArgs = {
  allocatedGatewayFeeNgn: 250,
  externalGatewayReference: 'PSK_REF',
  settlementGateway: 'paystack',
  transaction,
} as const;

describe('buildSettlementExecutor Paystack collection routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records a subaccount-split Paystack sale as direct-settled history instead of crediting the merchant wallet', async () => {
    const { rpc, supabase } = setup();

    await buildSettlementExecutor({ ...baseArgs, supabase })(
      contextWith(splitResponse)
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'record_paystack_direct_split_settlement',
      expect.objectContaining({
        p_gateway: 'paystack',
        p_gateway_reference: 'PSK_REF',
        p_paystack_subaccount_code: 'ACCT_merchant1',
        p_platform_fee: 99.5,
        p_metadata: {
          paystack_collection: 'direct_split',
          paystack_integration_share_kobo: 5000,
          paystack_reference: 'PSK_REF',
          paystack_subaccount_code: 'ACCT_merchant1',
          paystack_subaccount_share_kobo: 1_965_000,
          paystack_transaction_charge_kobo: 205_000,
          verified_gateway_fee: 250,
        },
      })
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'record_merchant_settlement',
      expect.anything()
    );
  });

  it('omits an absent transaction charge from direct-split metadata', async () => {
    const { rpc, supabase } = setup();

    // Bank-transfer DVA shape: no transaction_charge, Baci's share is 0.
    await buildSettlementExecutor({ ...baseArgs, supabase })(
      contextWith({
        amount: 2_000_000,
        fees_split: { integration: 0, paystack: 30_000, subaccount: 1_970_000 },
        subaccount: { subaccount_code: 'ACCT_x' },
      })
    );

    expect(rpc).toHaveBeenCalledWith(
      'record_paystack_direct_split_settlement',
      expect.objectContaining({
        p_metadata: {
          paystack_collection: 'direct_split',
          paystack_integration_share_kobo: 0,
          paystack_reference: 'PSK_REF',
          paystack_subaccount_code: 'ACCT_x',
          paystack_subaccount_share_kobo: 1_970_000,
          verified_gateway_fee: 250,
        },
      })
    );
  });

  it('fails closed when the verified split covers a different amount than this order transaction', async () => {
    // A wallet-funded order can be completed by a transfer bigger or smaller
    // than the order payment; its split shares are not this sale's history.
    const { rpc, supabase } = setup();

    await expect(
      buildSettlementExecutor({ ...baseArgs, supabase })(
        contextWith({
          ...splitResponse,
          // A consistent split, but for a ₦25,000 transfer, not this ₦20,000 sale.
          amount: 2_500_000,
          fees_split: {
            ...splitResponse.fees_split,
            subaccount: 2_465_000,
          },
        })
      )
    ).rejects.toThrow('paystack_settlement_collection_inconsistent');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not record direct-settled history when Paystack names a subaccount but proves no merchant share', async () => {
    const { rpc, supabase } = setup();

    await expect(
      buildSettlementExecutor({ ...baseArgs, supabase })(
        contextWith({ subaccount: { subaccount_code: 'ACCT_x' } })
      )
    ).rejects.toThrow('paystack_settlement_collection_unknown');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('routes a split GIGL customer-checkout order to the direct GIGL variant with the base platform fee', async () => {
    const { rpc, supabase } = setup();

    const result = await buildSettlementExecutor({
      ...baseArgs,
      orderShippingFundingSource: 'customer_checkout',
      orderShippingProvider: 'GIGL',
      orderShippingRetainedAmount: 200,
      supabase,
    })(contextWith(splitResponse));

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'record_paystack_direct_split_settlement_gigl_v1',
      expect.objectContaining({
        p_paystack_subaccount_code: 'ACCT_merchant1',
        p_platform_fee: 99.5,
      })
    );
    expect(result).toMatchObject({
      commerce_platform_fee: 99.5,
      retained_shipping_amount: 200,
    });
    expect(supabase.from).toHaveBeenCalledWith('merchant_settlements');
  });

  it('keeps crediting the wallet for integration-collected Paystack sales and marks them', async () => {
    const { rpc, supabase } = setup();

    await buildSettlementExecutor({ ...baseArgs, supabase })(
      contextWith({ fees_split: null, subaccount: {} })
    );

    expect(rpc).toHaveBeenCalledWith(
      'record_merchant_settlement',
      expect.objectContaining({
        p_metadata: {
          paystack_collection: 'integration',
          paystack_reference: 'PSK_REF',
          verified_gateway_fee: 250,
        },
      })
    );
    const [, params] = rpc.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(params).not.toHaveProperty('p_paystack_subaccount_code');
  });

  it('marks integration-collected GIGL orders and keeps the GIGL wallet RPC', async () => {
    const { rpc, supabase } = setup();

    await buildSettlementExecutor({
      ...baseArgs,
      orderShippingFundingSource: 'customer_checkout',
      orderShippingProvider: 'GIGL',
      orderShippingRetainedAmount: 200,
      supabase,
    })(contextWith({ fees_split: null, subaccount: null }));

    expect(rpc).toHaveBeenCalledWith(
      'record_merchant_settlement_gigl_v1',
      expect.objectContaining({
        p_metadata: expect.objectContaining({
          paystack_collection: 'integration',
        }),
      })
    );
  });

  it('fails closed before any RPC when the payload cannot prove where the money went', async () => {
    const { rpc, supabase } = setup();

    await expect(
      buildSettlementExecutor({ ...baseArgs, supabase })(
        contextWith({ fees: 30_000 })
      )
    ).rejects.toThrow('paystack_settlement_collection_unknown');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('lets REDVAULT routing win even when a subaccount is present', async () => {
    const { rpc, supabase } = setup();

    await buildSettlementExecutor({
      ...baseArgs,
      orderPaymentMethod: 'uba_redvault',
      supabase,
    })(contextWith(splitResponse));

    expect(rpc).toHaveBeenCalledWith(
      'record_uba_redvault_direct_settlement',
      expect.not.objectContaining({
        p_paystack_subaccount_code: expect.anything(),
      })
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not require a subaccount for Korapay or apply Paystack metadata', async () => {
    const { rpc, supabase } = setup();

    await buildSettlementExecutor({
      ...baseArgs,
      settlementGateway: 'korapay',
      supabase,
    })(contextWith({ status: 'success' }));

    expect(rpc).toHaveBeenCalledWith(
      'record_merchant_settlement',
      expect.objectContaining({
        p_metadata: { korapay_reference: 'PSK_REF', verified_gateway_fee: 250 },
      })
    );
  });
});
