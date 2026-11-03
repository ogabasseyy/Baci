import { describe, expect, it, vi } from 'vitest';
import {
  createPetrockRemediationOrderState,
  loadPetrockRemediationOrderContext,
} from './petrock-remediation-order-state';

describe('createPetrockRemediationOrderState', () => {
  it('prepares an operator-approved quote through the atomic RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: 'order-1', status: 'payment_pending' }],
      error: null,
    });
    const state = createPetrockRemediationOrderState({
      customerId: 'customer-1',
      fxRate: 1575,
      merchantId: 'merchant-1',
      supabaseAdmin: { rpc } as never,
    });

    await state.prepare({
      orderId: 'order-1',
      paymentCurrency: 'USDT',
      productId: 'product-1',
    });

    expect(rpc).toHaveBeenCalledWith('prepare_petrock_remediation_order', {
      p_customer_id: 'customer-1',
      p_fx_rate: 1575,
      p_merchant_id: 'merchant-1',
      p_order_id: 'order-1',
      p_payment_currency: 'USDT',
      p_product_id: 'product-1',
    });
  });

  it('uses the force-refund RPC for failures before provider acceptance', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const state = createPetrockRemediationOrderState({
      customerId: 'customer-1',
      fxRate: 1575,
      merchantId: 'merchant-1',
      supabaseAdmin: { rpc } as never,
    });

    await state.failBeforeAcceptance({
      customerMessage: 'Refunded',
      orderId: 'order-1',
      reason: 'preflight_failed',
    });

    expect(rpc).toHaveBeenCalledWith(
      'fail_petrock_remediation_before_acceptance',
      {
        p_customer_message: 'Refunded',
        p_order_id: 'order-1',
        p_reason: 'preflight_failed',
      }
    );
  });
});

it('loads persisted evidence and product scope for final-order revalidation', async () => {
  const evidence = {
    blacklistStatus: 'Clean',
    simLock: 'Locked',
    financeStatus: 'Not Eligible',
  };
  const rows = {
    petrock_orders: {
      id: 'o1',
      status: 'paid',
      eligibility_evidence: evidence,
      provider_order_id: null,
      provider_attempt_started_at: null,
    },
    petrock_remediation_products: {
      id: 'p1',
      provider_product_id: 'unlock-1',
      carrier: 'AT&T',
      model_scope: { kind: 'generic' },
      status_segment: 'clean',
    },
    imei_provider_products: { product_id: 'unlock-1' },
  };
  const builders = Object.fromEntries(
    Object.entries(rows).map(([table, data]) => {
      const builder = {
        select: vi.fn(),
        match: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
      };
      builder.select.mockReturnValue(builder);
      builder.match.mockReturnValue(builder);
      return [table, builder];
    })
  );
  const result = await loadPetrockRemediationOrderContext({
    customerId: 'c1',
    merchantId: 'm1',
    orderId: 'o1',
    productId: 'p1',
    supabaseAdmin: { from: (table: string) => builders[table] } as never,
  });
  expect(result?.order.eligibilityEvidence).toEqual(evidence);
  expect(result?.product).toMatchObject({
    carrier: 'AT&T',
    modelScope: { kind: 'generic' },
    statusSegment: 'clean',
  });
  expect(builders.petrock_orders.match).toHaveBeenCalledWith({
    customer_id: 'c1',
    merchant_id: 'm1',
    id: 'o1',
  });
  expect(builders.petrock_orders.select.mock.calls[0][0]).toContain(
    'eligibility_evidence'
  );
  expect(
    builders.petrock_remediation_products.select.mock.calls[0][0]
  ).toContain('model_scope');
});
