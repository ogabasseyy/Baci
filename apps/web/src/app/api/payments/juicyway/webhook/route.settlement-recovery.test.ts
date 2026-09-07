import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as webhookTest from './route.test-helpers';

let mockVerifyWebhookSignature: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  mockVerifyWebhookSignature = await webhookTest.setupJuicywayWebhookTest();
});

const baseTransaction = {
  amount: '10000',
  gateway_reference: 'TXN-123456',
  id: 'txn-123',
  merchant_id: 'merchant-123',
  metadata: {
    juicyway_expected_amount: 10000,
    juicyway_expected_currency: 'NGN',
  },
  order_id: 'order-123',
  platform_fee: '150',
  status: 'pending',
};

type TestTransaction = Omit<typeof baseTransaction, 'platform_fee'> & {
  platform_fee: string | null;
};

function transactionTable(
  callCount: number,
  transaction: TestTransaction = baseTransaction
) {
  if (callCount === 1) {
    return {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: transaction, error: null }),
    };
  }
  return {
    eq: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn().mockReturnThis(),
  };
}

function updateChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  for (const method of ['eq', 'in', 'select']) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

describe('POST /api/payments/juicyway/webhook — settlement recovery', () => {
  it('records settlement idempotently when the paid flip finds 0 rows', async () => {
    mockVerifyWebhookSignature.mockResolvedValue(true);
    let transactionCallCount = 0;
    const precisionTransaction = {
      ...baseTransaction,
      amount: '100.01',
      platform_fee: null,
    };
    const fromMock = vi.fn((table) => {
      if (table === 'transactions') {
        transactionCallCount += 1;
        return transactionTable(transactionCallCount, precisionTransaction);
      }
      if (table === 'orders') {
        return {
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              cancelled_at: null,
              id: 'order-123',
              order_number: 'ORD-123',
              payment_status: 'paid',
              shipping_status: 'processing',
            },
            error: null,
          }),
          select: vi.fn().mockReturnThis(),
          update: vi.fn(() => updateChain({ data: null, error: null })),
        };
      }
      return { eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis() };
    });
    (webhookTest.mockSupabase as Record<string, unknown>).from = fromMock;
    webhookTest.mockAdminSupabase.rpc.mockResolvedValue({ error: null });

    const response = await webhookTest.postJuicywayWebhook(
      webhookTest.createWebhookRequest(webhookTest.createSuccessPayload())
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: 'Already processed' });
    expect(webhookTest.mockAdminSupabase.rpc).toHaveBeenCalledWith(
      'record_merchant_settlement',
      expect.objectContaining({
        p_gross_amount: 100.01,
        p_platform_fee: 1.5,
        p_source_id: 'order-123',
      })
    );
  });

  it('records settlement but fails closed when the order update errors', async () => {
    mockVerifyWebhookSignature.mockResolvedValue(true);
    let transactionCallCount = 0;
    const fromMock = vi.fn((table) => {
      if (table === 'transactions') {
        transactionCallCount += 1;
        return transactionTable(transactionCallCount);
      }
      if (table === 'orders') {
        return {
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              shipping_funding_source: null,
              shipping_platform_retained_amount: null,
              shipping_provider: null,
            },
            error: null,
          }),
          select: vi.fn().mockReturnThis(),
          update: vi.fn(() =>
            updateChain({ data: null, error: { message: 'column missing' } })
          ),
        };
      }
      return { eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis() };
    });
    (webhookTest.mockSupabase as Record<string, unknown>).from = fromMock;
    webhookTest.mockAdminSupabase.rpc.mockResolvedValue({ error: null });

    const response = await webhookTest.postJuicywayWebhook(
      webhookTest.createWebhookRequest(webhookTest.createSuccessPayload())
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: 'ORDER_PAYMENT_COMPLETION_FAILED',
      error: 'Order payment completion failed',
    });
  });

  it('files blocked unpaid order states for review instead of settling', async () => {
    mockVerifyWebhookSignature.mockResolvedValue(true);
    let transactionCallCount = 0;
    const fromMock = vi.fn((table) => {
      if (table === 'transactions') {
        transactionCallCount += 1;
        return transactionTable(transactionCallCount);
      }
      if (table === 'orders') {
        return {
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              cancelled_at: null,
              id: 'order-123',
              order_number: 'ORD-123',
              payment_status: 'bnpl_pending',
              shipping_status: 'pending',
            },
            error: null,
          }),
          select: vi.fn().mockReturnThis(),
          update: vi.fn(() => updateChain({ data: null, error: null })),
        };
      }
      return { eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis() };
    });
    (webhookTest.mockSupabase as Record<string, unknown>).from = fromMock;

    const response = await webhookTest.postJuicywayWebhook(
      webhookTest.createWebhookRequest(webhookTest.createSuccessPayload())
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: 'Payment recorded; blocked order filed for review',
      success: true,
    });
    expect(webhookTest.mockReconciliationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'gateway_payment_wedge_requires_review',
        order_id: 'order-123',
      })
    );
    expect(webhookTest.mockAdminSupabase.rpc).not.toHaveBeenCalled();
  });

  it('routes GIGL customer-checkout settlements through the GIGL wrapper', async () => {
    mockVerifyWebhookSignature.mockResolvedValue(true);
    let transactionCallCount = 0;
    const fromMock = vi.fn((table) => {
      if (table === 'transactions') {
        transactionCallCount += 1;
        return transactionTable(transactionCallCount);
      }
      if (table === 'orders') {
        return {
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              cancelled_at: null,
              id: 'order-123',
              order_number: 'ORD-123',
              payment_status: 'paid',
              shipping_funding_source: 'customer_checkout',
              shipping_platform_retained_amount: 1_500,
              shipping_provider: 'GIGL',
              shipping_status: 'processing',
            },
            error: null,
          }),
          select: vi.fn().mockReturnThis(),
          update: vi.fn(() => updateChain({ data: null, error: null })),
        };
      }
      return { eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis() };
    });
    (webhookTest.mockSupabase as Record<string, unknown>).from = fromMock;
    webhookTest.mockAdminSupabase.rpc.mockResolvedValue({ error: null });

    const response = await webhookTest.postJuicywayWebhook(
      webhookTest.createWebhookRequest(webhookTest.createSuccessPayload())
    );

    expect(response.status).toBe(200);
    expect(webhookTest.mockAdminSupabase.rpc).toHaveBeenCalledWith(
      'record_merchant_settlement_gigl_v1',
      expect.objectContaining({
        p_platform_fee: 150,
        p_metadata: expect.objectContaining({
          commerce_platform_fee: 150,
          retained_shipping_amount: 1_500,
          juicyway_reference: 'TXN-123456',
        }),
      })
    );
  });
});
