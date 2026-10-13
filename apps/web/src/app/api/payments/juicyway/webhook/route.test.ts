import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JuicywayWebhookPayload } from '@/lib/juicyway';
import * as webhookTest from './route.test-helpers';

let mockVerifyWebhookSignature: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  mockVerifyWebhookSignature = await webhookTest.setupJuicywayWebhookTest();
});

describe('POST /api/payments/juicyway/webhook', () => {
  it('returns 500 when JUICYWAY_BUSINESS_ID is not configured', async () => {
    delete process.env.JUICYWAY_BUSINESS_ID;

    const payload = webhookTest.createSuccessPayload();
    const request = webhookTest.createWebhookRequest(payload);

    const response = await webhookTest.postJuicywayWebhook(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: 'Server configuration error' });
  });

  // ---------------------------------------------------------------------------
  // Signature Verification Tests
  // ---------------------------------------------------------------------------

  it('returns 401 when webhook signature is invalid', async () => {
    mockVerifyWebhookSignature.mockResolvedValue(false);

    const payload = webhookTest.createSuccessPayload();
    const request = webhookTest.createWebhookRequest(payload);

    const response = await webhookTest.postJuicywayWebhook(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: 'Invalid signature' });
    expect(mockVerifyWebhookSignature).toHaveBeenCalledWith(
      'payment.session.succeeded',
      payload.data,
      'valid-checksum',
      'test-business-id'
    );
  });

  // ---------------------------------------------------------------------------
  // Event Type Tests
  // ---------------------------------------------------------------------------

  it('returns 200 for failed payment event', async () => {
    mockVerifyWebhookSignature.mockResolvedValue(true);

    const payload = webhookTest.createFailedPayload();
    const request = webhookTest.createWebhookRequest(payload);

    const response = await webhookTest.postJuicywayWebhook(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ message: 'Failure noted' });
  });

  it('returns 200 for ignored non-success event', async () => {
    mockVerifyWebhookSignature.mockResolvedValue(true);

    const payload: JuicywayWebhookPayload = {
      ...webhookTest.createSuccessPayload(),
      event: 'payment.session.failed', // Not a success event
    };
    payload.data.status = 'failed';

    const request = webhookTest.createWebhookRequest(payload);

    const response = await webhookTest.postJuicywayWebhook(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ message: 'Failure noted' });
  });

  // ---------------------------------------------------------------------------
  // Transaction Not Found Tests
  // ---------------------------------------------------------------------------

  it('returns 404 when transaction is not found', async () => {
    mockVerifyWebhookSignature.mockResolvedValue(true);

    const fromMock = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Not found', code: 'PGRST116' },
      }),
    }));

    (webhookTest.mockSupabase as Record<string, unknown>).from = fromMock;

    const payload = webhookTest.createSuccessPayload();
    const request = webhookTest.createWebhookRequest(payload);

    const response = await webhookTest.postJuicywayWebhook(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ error: 'Transaction not found' });
    expect(fromMock).toHaveBeenCalledWith('transactions');
  });

  // ---------------------------------------------------------------------------
  // Idempotency Tests
  // ---------------------------------------------------------------------------

  it('returns 200 when transaction is already completed (idempotent)', async () => {
    mockVerifyWebhookSignature.mockResolvedValue(true);

    const fromMock = vi.fn((table) => {
      if (table === 'transactions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'txn-123',
              status: 'completed', // Already completed
              gateway_reference: 'TXN-123456',
              amount: '10000',
              merchant_id: 'merchant-123',
              order_id: 'order-123',
            },
            error: null,
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    (webhookTest.mockSupabase as Record<string, unknown>).from = fromMock;

    const payload = webhookTest.createSuccessPayload();
    const request = webhookTest.createWebhookRequest(payload);

    const response = await webhookTest.postJuicywayWebhook(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ message: 'Already processed' });
  });

  it('includes selected condition and variant labels in the confirmation email', async () => {
    mockVerifyWebhookSignature.mockResolvedValue(true);
    const { generateOrderConfirmationEmail } = await import(
      '@/lib/email-templates'
    );

    const transaction = webhookTest.pendingCryptoTxn({
      juicyway_expected_amount: 10000,
      juicyway_expected_currency: 'USDT',
    });
    const state = webhookTest.wireProcessingMocks(transaction, {
      orderItems: [
        {
          condition: 'used',
          id: 'item-123',
          name: 'iPad Pro',
          price: 9500,
          product_id: 'product-123',
          quantity: 1,
          subtotal: 9500,
          variant_name: '128GB WiFi Used',
        },
      ],
    });

    const payload = webhookTest.createSuccessPayload();
    payload.data.amount = 10000;
    payload.data.currency = 'USDT';

    const response = await webhookTest.postJuicywayWebhook(
      webhookTest.createWebhookRequest(payload)
    );

    expect(response.status).toBe(200);
    expect(state.orderUpdated).toBe(true);
    expect(generateOrderConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            name: 'iPad Pro (Used / 128GB WiFi)',
          }),
        ],
      })
    );
  });

  it('keeps the plain product name when no condition or variant is selected', async () => {
    mockVerifyWebhookSignature.mockResolvedValue(true);
    const { generateOrderConfirmationEmail } = await import(
      '@/lib/email-templates'
    );

    const transaction = webhookTest.pendingCryptoTxn({
      juicyway_expected_amount: 10000,
      juicyway_expected_currency: 'USDT',
    });
    const state = webhookTest.wireProcessingMocks(transaction, {
      orderItems: [
        {
          condition: null,
          id: 'item-123',
          name: 'iPad Pro',
          price: 9500,
          product_id: 'product-123',
          quantity: 1,
          subtotal: 9500,
          variant_name: null,
        },
      ],
    });

    const payload = webhookTest.createSuccessPayload();
    payload.data.amount = 10000;
    payload.data.currency = 'USDT';

    const response = await webhookTest.postJuicywayWebhook(
      webhookTest.createWebhookRequest(payload)
    );

    expect(response.status).toBe(200);
    expect(state.orderUpdated).toBe(true);
    expect(generateOrderConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            name: 'iPad Pro',
          }),
        ],
      })
    );
  });

  it('files reconciliation before acknowledging an already-completed transaction for a cancelled order', async () => {
    mockVerifyWebhookSignature.mockResolvedValue(true);

    const fromMock = vi.fn((table) => {
      if (table === 'transactions') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'txn-123',
              status: 'completed',
              gateway_reference: 'TXN-123456',
              amount: '10000',
              merchant_id: 'merchant-123',
              order_id: 'order-123',
            },
            error: null,
          }),
        };
      }
      if (table === 'orders') {
        return webhookTest.wrapOrdersTableMock({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'order-123',
              shipping_status: 'cancelled',
              cancelled_at: '2026-06-15T00:00:00Z',
            },
            error: null,
          }),
        });
      }
      throw new Error(`Unexpected table ${table}`);
    });

    (webhookTest.mockSupabase as Record<string, unknown>).from = fromMock;

    const payload = webhookTest.createSuccessPayload();
    const request = webhookTest.createWebhookRequest(payload);

    const response = await webhookTest.postJuicywayWebhook(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ message: 'Already processed' });
    expect(webhookTest.mockReconciliationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'payment_received_after_cancellation',
        order_id: 'order-123',
        txn_id: 'txn-123',
      })
    );
  });
});
