import { describe, expect, it, vi } from 'vitest';
import { buildReconcileSettlementExecutor } from './reconcile-paystack-dva-settlement-executor';

vi.mock('@/lib/paystack', () => ({
  calculatePlatformFee: vi.fn(() => ({ platformFee: 2050 })),
}));

function build(richOrder: Record<string, unknown> = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const executor = buildReconcileSettlementExecutor({
    actor: 'ops',
    order: { id: 'order-1', merchant_id: 'merchant-1' } as never,
    paystackReference: '100000000',
    rawPlatformFee: 20.5,
    richOrder: richOrder as never,
    supabase: { rpc } as never,
    transaction: { amount: 50_000, gateway_reference: 'BAC-XYZ' } as never,
  });
  return { executor, rpc };
}

const ctx = (gatewayResponse: Record<string, unknown>) =>
  ({ gatewayResponse }) as never;

const split = {
  amount: 5_000_000,
  fees_split: { integration: 0, paystack: 30_000, subaccount: 4_970_000 },
  subaccount: { subaccount_code: 'ACCT_store' },
};

describe('buildReconcileSettlementExecutor', () => {
  it('records a GIGL customer-checkout split as GIGL direct-settled history', async () => {
    const { executor, rpc } = build({
      shipping_funding_source: 'customer_checkout',
      shipping_provider: ' gigl ',
    });

    await executor(ctx(split));

    expect(rpc).toHaveBeenCalledWith(
      'record_paystack_direct_split_settlement_gigl_v1',
      expect.objectContaining({
        p_gateway_reference: 'BAC-XYZ',
        p_paystack_subaccount_code: 'ACCT_store',
        p_platform_fee: 20.5,
      })
    );
  });

  it('keeps a Baci-collected non-GIGL payment on the wallet recorder, marked spendable', async () => {
    const { executor, rpc } = build();

    await executor(ctx({ fees_split: null, subaccount: {} }));

    expect(rpc).toHaveBeenCalledWith(
      'record_merchant_settlement',
      expect.objectContaining({
        p_metadata: expect.objectContaining({
          paystack_collection: 'integration',
          reconciled_by: 'ops',
        }),
      })
    );
  });

  it('throws on a returned RPC error', async () => {
    const { executor, rpc } = build();
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });

    await expect(executor(ctx({ fees_split: null, subaccount: {} }))).rejects.toThrow('denied');
  });
});
