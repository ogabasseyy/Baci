import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as webhookTest from './route.test-helpers';

const DOMAIN_EVENT_ID = '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234';
const mocks = vi.hoisted(() => ({ scheduleLegacy: vi.fn() }));

vi.mock('@/lib/payments/schedule-legacy-purchase-conversion', () => ({
  scheduleLegacyPurchaseConversion: mocks.scheduleLegacy,
}));

let mockVerifyWebhookSignature: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  mockVerifyWebhookSignature = await webhookTest.setupJuicywayWebhookTest();
  process.env.EVENT_PIPELINE_ENQUEUE_ENABLED = 'true';
});

afterEach(() => {
  delete process.env.EVENT_PIPELINE_ENQUEUE_ENABLED;
});

describe('POST /api/payments/juicyway/webhook durable event handoff', () => {
  it('finishes settlement and returns 500 when the durable enqueue fails', async () => {
    mockVerifyWebhookSignature.mockResolvedValue(true);
    webhookTest.wireProcessingMocks(
      webhookTest.pendingCryptoTxn({
        juicyway_expected_amount: 10_000,
        juicyway_expected_currency: 'NGN',
      })
    );
    webhookTest.mockAdminSupabase.rpc = vi.fn(async (name: string) =>
      name === 'enqueue_domain_event_v1'
        ? { data: null, error: { message: 'queue unavailable' } }
        : { data: null, error: null }
    );

    const response = await webhookTest.postJuicywayWebhook(
      webhookTest.createWebhookRequest(webhookTest.createSuccessPayload())
    );

    expect(response.status).toBe(500);
    expect(webhookTest.mockAdminSupabase.rpc).toHaveBeenCalledWith(
      'record_merchant_settlement',
      expect.objectContaining({ p_source_id: 'order-123' })
    );
    expect(mocks.scheduleLegacy).not.toHaveBeenCalled();
  }, 20_000);

  it('reschedules the idempotent legacy fanout for an already-completed paid order', async () => {
    mockVerifyWebhookSignature.mockResolvedValue(true);
    const fromMock = vi.fn((table: string) => {
      if (table === 'transactions') {
        return {
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              amount: '10000',
              id: 'txn-123',
              merchant_id: 'merchant-123',
              order_id: 'order-123',
              status: 'completed',
            },
            error: null,
          }),
        };
      }
      if (table === 'orders') {
        return webhookTest.wrapOrdersTableMock({
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              ad_tracking: { eventId: 'browser-event-123' },
              cancelled_at: null,
              id: 'order-123',
              payment_status: 'paid',
              shipping_status: 'processing',
              total: '10000',
            },
            error: null,
          }),
          select: vi.fn().mockReturnThis(),
        });
      }
      throw new Error(`Unexpected table ${table}`);
    });
    (webhookTest.mockSupabase as Record<string, unknown>).from = fromMock;
    webhookTest.mockAdminSupabase.rpc = vi.fn(async (name: string) =>
      name === 'enqueue_domain_event_v1'
        ? {
            data: [
              {
                already_enqueued: true,
                domain_event_id: DOMAIN_EVENT_ID,
                queue_message_id: 42,
              },
            ],
            error: null,
          }
        : { data: null, error: null }
    );

    const response = await webhookTest.postJuicywayWebhook(
      webhookTest.createWebhookRequest(webhookTest.createSuccessPayload())
    );

    expect(response.status).toBe(200);
    expect(webhookTest.mockAdminSupabase.rpc).toHaveBeenCalledWith(
      'enqueue_domain_event_v1',
      expect.objectContaining({
        p_external_event_id: 'browser-event-123',
        p_idempotency_key: 'paid-order-ad-tracking:order-123',
      })
    );
    expect(mocks.scheduleLegacy).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-123',
        order: expect.objectContaining({ id: 'order-123', total: '10000' }),
        scheduleAfter: expect.any(Function),
      })
    );
  });

  it('schedules legacy fanout when a completed retry recovers a failed durable enqueue', async () => {
    mockVerifyWebhookSignature.mockResolvedValue(true);
    const fromMock = vi.fn((table: string) => {
      if (table === 'transactions') {
        return {
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              amount: '10000',
              id: 'txn-123',
              merchant_id: 'merchant-123',
              order_id: 'order-123',
              status: 'completed',
            },
            error: null,
          }),
        };
      }
      if (table === 'orders') {
        return webhookTest.wrapOrdersTableMock({
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              ad_tracking: { eventId: 'browser-event-123' },
              cancelled_at: null,
              id: 'order-123',
              payment_status: 'paid',
              shipping_status: 'processing',
              total: '10000',
            },
            error: null,
          }),
          select: vi.fn().mockReturnThis(),
        });
      }
      throw new Error(`Unexpected table ${table}`);
    });
    (webhookTest.mockSupabase as Record<string, unknown>).from = fromMock;
    webhookTest.mockAdminSupabase.rpc = vi.fn(async (name: string) =>
      name === 'enqueue_domain_event_v1'
        ? {
            data: [
              {
                already_enqueued: false,
                domain_event_id: DOMAIN_EVENT_ID,
                queue_message_id: 42,
              },
            ],
            error: null,
          }
        : { data: null, error: null }
    );

    const response = await webhookTest.postJuicywayWebhook(
      webhookTest.createWebhookRequest(webhookTest.createSuccessPayload())
    );

    expect(response.status).toBe(200);
    expect(mocks.scheduleLegacy).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-123',
        order: expect.objectContaining({ id: 'order-123', total: '10000' }),
        scheduleAfter: expect.any(Function),
      })
    );
  });
});
