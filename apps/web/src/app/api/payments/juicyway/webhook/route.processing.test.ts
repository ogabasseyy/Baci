import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as webhookTest from './route.test-helpers';

let mockVerifyWebhookSignature: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  mockVerifyWebhookSignature = await webhookTest.setupJuicywayWebhookTest();
});

describe('POST /api/payments/juicyway/webhook processing', () => {
  it('returns 200 and processes successful payment', async () => {
    mockVerifyWebhookSignature.mockResolvedValue(true);

    const transaction = {
      id: 'txn-123',
      status: 'pending',
      gateway_reference: 'TXN-123456',
      amount: '10000',
      platform_fee: '150',
      merchant_id: 'merchant-123',
      order_id: 'order-123',
      metadata: {
        juicyway_expected_amount: 10000,
        juicyway_expected_currency: 'NGN',
      },
    };

    const order = {
      id: 'order-123',
      order_number: 'ORD-001',
      customer_email: 'customer@example.com',
      customer_name: 'Jane Doe',
      customer_phone: '+2341234567890',
      subtotal: '9500',
      shipping_fee: '500',
      total: '10000',
      currency: 'NGN',
      customer_id: 'customer-123',
      shipping_address: {
        address: '123 Main St',
        city: 'Lagos',
        state: 'Lagos',
      },
      order_items: [
        {
          id: 'item-1',
          name: 'Product A',
          quantity: 1,
          price: 9500,
          product_id: 'prod-1',
        },
      ],
      ad_tracking: null,
    };

    const merchant = {
      business_name: 'Test Store',
      slug: 'test-store',
      support_email: 'support@test-store.com',
      email_sender_name: 'Test Store',
      email: 'admin@test-store.com',
      offline_conversions_enabled: false,
    };

    let transactionCallCount = 0;
    let orderUpdated = false;

    const fromMock = vi.fn((table) => {
      if (table === 'transactions') {
        transactionCallCount++;
        if (transactionCallCount === 1) {
          // First call: fetch transaction
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi
              .fn()
              .mockResolvedValue({ data: transaction, error: null }),
          };
        }
        // Second call: update transaction
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        };
      }

      if (table === 'orders') {
        return webhookTest.wrapOrdersTableMock({
          update: vi.fn(() => {
            orderUpdated = true;
            const chain: Record<string, unknown> = {
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: order, error: null }),
              single: vi.fn().mockResolvedValue({ data: order, error: null }),
            };
            chain.eq = vi.fn().mockReturnValue(chain);
            chain.neq = vi.fn().mockReturnValue(chain);
            chain.in = vi.fn().mockReturnValue(chain);
            chain.select = vi.fn().mockReturnValue(chain);
            return chain;
          }),
        });
      }

      if (table === 'merchants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: merchant, error: null }),
        };
      }

      return {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(),
      };
    });

    (webhookTest.mockSupabase as Record<string, unknown>).from = fromMock;
    webhookTest.mockSupabase.rpc = vi.fn().mockResolvedValue({ error: null });
    webhookTest.mockAdminSupabase.rpc = vi
      .fn()
      .mockResolvedValue({ error: null });

    const payload = webhookTest.createSuccessPayload();
    const request = webhookTest.createWebhookRequest(payload);

    const response = await webhookTest.postJuicywayWebhook(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      message: 'Payment processed successfully',
    });
    expect(transactionCallCount).toBe(2); // Should have been called twice (fetch + update)
    expect(orderUpdated).toBe(true);
    expect(webhookTest.getMockCreateServerClient()).not.toHaveBeenCalled();

    // Verify settlement RPC was called via the admin (service-role) client.
    // Δ-0a/Δ-0b: gateway_fee is no longer read from the transaction column
    // (which doesn't exist); Juicyway verify carries no fee, so 0 is honest.
    // Δ-29: traceability for the gateway-side ref now lives in p_metadata.
    expect(webhookTest.mockAdminSupabase.rpc).toHaveBeenCalledWith(
      'record_merchant_settlement',
      expect.objectContaining({
        p_merchant_id: 'merchant-123',
        p_source_type: 'order',
        p_source_id: 'order-123',
        p_gateway: 'juicyway',
        p_gateway_reference: 'TXN-123456',
        p_gross_amount: 10000,
        p_gateway_fee: 0,
        p_platform_fee: 150,
        p_description: 'Order payment via Juicyway',
        p_metadata: { juicyway_reference: 'TXN-123456' },
      })
    );
  });
});
