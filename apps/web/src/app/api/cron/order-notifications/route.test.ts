import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({
  getCronSecret: () => 'secret',
}));

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => mockSupabase,
}));

const mockSendOrderFulfillmentNotification = vi.hoisted(() => vi.fn());
const mockSendManualOrderDocument = vi.hoisted(() => vi.fn());

vi.mock('@/lib/order-fulfillment-notification', () => ({
  sendOrderFulfillmentNotification: mockSendOrderFulfillmentNotification,
}));

vi.mock('@/lib/send-manual-order-document', () => ({
  sendManualOrderDocument: mockSendManualOrderDocument,
}));

import { sendOrderFulfillmentNotification } from '@/lib/order-fulfillment-notification';
import { GET, maxDuration } from './route';

function cronRequest(path = '/api/cron/order-notifications') {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: { Authorization: 'Bearer secret' },
    method: 'GET',
  });
}

function createUpdateBuilder() {
  let matchedId = '';
  const maybeSingle = vi.fn<
    () => Promise<{ data: { id: string } | null; error: unknown }>
  >(async () => ({ data: { id: matchedId }, error: null }));
  const builder = {
    match: vi.fn((values: { id: string }) => {
      matchedId = values.id;
      return builder;
    }),
    maybeSingle,
    select: vi.fn(() => builder),
    update: vi.fn(() => builder),
  };
  return builder;
}

describe('GET /api/cron/order-notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.rpc.mockResolvedValue({
      data: [
        {
          claim_owner: 'web-cron-test',
          attempt_count: 1,
          event_type: 'order_shipped',
          id: 'outbox-1',
          max_attempts: 5,
          metadata: {
            manual_courier_name: 'DHL',
            manual_estimated_delivery: '2026-07-15',
            manual_tracking_number: 'TRACK-123',
          },
          merchant_id: 'merchant-1',
          order_id: 'order-1',
        },
        {
          claim_owner: 'web-cron-test',
          attempt_count: 1,
          event_type: 'order_delivered',
          id: 'outbox-2',
          max_attempts: 5,
          merchant_id: 'merchant-1',
          order_id: 'order-2',
        },
      ],
      error: null,
    });
    mockSupabase.from.mockReturnValue(createUpdateBuilder());
    mockSendManualOrderDocument.mockResolvedValue({
      status: 'sent',
      messageId: 'manual-document-1',
    });
    mockSendOrderFulfillmentNotification
      .mockResolvedValueOnce({ status: 'sent', messageId: 'msg-1' })
      .mockResolvedValueOnce({
        status: 'skipped',
        reason: 'missing_customer_email',
      });
  });

  it('exposes a bounded duration for VPS cron execution', () => {
    expect(maxDuration).toBe(60);
  });

  it('rejects missing cron bearer tokens fail-closed', async () => {
    const response = await GET(
      new NextRequest('http://localhost:3000/api/cron/order-notifications')
    );

    expect(response.status).toBe(401);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
    expect(mockSendManualOrderDocument).not.toHaveBeenCalled();
  });

  it('returns 500 when claiming outbox rows fails', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'rpc down' },
    });

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to claim order notifications' });
    expect(sendOrderFulfillmentNotification).not.toHaveBeenCalled();
  });

  it('returns 500 when the claim RPC returns a malformed payload', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: { id: 'outbox-invalid' },
      error: null,
    });

    const response = await GET(cronRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid claimed order notification payload',
    });
    expect(sendOrderFulfillmentNotification).not.toHaveBeenCalled();
  });

  it('skips unknown event types without failing the rest of the batch', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        { id: 'outbox-invalid', event_type: 'order_cancelled' },
        {
          claim_owner: 'web-cron-test',
          attempt_count: 1,
          event_type: 'order_shipped',
          id: 'outbox-1',
          max_attempts: 5,
          merchant_id: 'merchant-1',
          order_id: 'order-1',
        },
      ],
      error: null,
    });
    mockSendOrderFulfillmentNotification.mockReset();
    mockSendOrderFulfillmentNotification.mockResolvedValue({
      status: 'sent',
      messageId: 'msg-1',
    });

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ claimed: 2, sent: 1, unparseable: 1 });
    expect(sendOrderFulfillmentNotification).toHaveBeenCalledTimes(1);
  });

  it('dead-letters corrupt rows that exhaust max attempts instead of looping', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          attempt_count: 5,
          event_type: 123,
          id: 'outbox-corrupt',
          max_attempts: 5,
        },
      ],
      error: null,
    });

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      claimed: 1,
      skipped: 1,
      success: true,
      unparseable: 1,
    });
    const updateBuilder = mockSupabase.from.mock.results[0]?.value;
    expect(mockSupabase.from).toHaveBeenCalledWith('order_notification_outbox');
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        skip_reason: 'unparseable',
        status: 'skipped',
      })
    );
    expect(updateBuilder.match).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'outbox-corrupt',
        status: 'processing',
      })
    );
  });

  it('leaves corrupt rows for lease expiry before max attempts', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          attempt_count: 1,
          event_type: 123,
          id: 'outbox-corrupt-early',
          max_attempts: 5,
        },
      ],
      error: null,
    });

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      claimed: 1,
      skipped: 0,
      unparseable: 1,
    });
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('dead-letters known-type rows missing permanently required fields', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          attempt_count: 5,
          event_type: 'order_shipped',
          id: 'outbox-corrupt-known',
          max_attempts: 5,
        },
      ],
      error: null,
    });

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      claimed: 1,
      skipped: 1,
      success: true,
      unparseable: 1,
    });
    const updateBuilder = mockSupabase.from.mock.results[0]?.value;
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        skip_reason: 'unparseable',
        status: 'skipped',
      })
    );
  });

  it('never dead-letters exhausted rows with a valid future event type', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          attempt_count: 9,
          event_type: 'order_cancelled',
          id: 'outbox-future',
          max_attempts: 5,
        },
      ],
      error: null,
    });

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      claimed: 1,
      skipped: 0,
      unparseable: 1,
    });
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('claims due notifications and marks sent/skipped outcomes without blocking fulfillment', async () => {
    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'claim_order_notification_outbox',
      expect.objectContaining({ p_batch_size: 1 })
    );
    expect(sendOrderFulfillmentNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        courierName: 'DHL',
        estimatedDelivery: '2026-07-15',
        eventType: 'order_shipped',
        merchantId: 'merchant-1',
        orderId: 'order-1',
        trackingNumber: 'TRACK-123',
      })
    );
    expect(body).toMatchObject({
      claimed: 2,
      failed: 0,
      retried: 0,
      sent: 1,
      skipped: 1,
      success: true,
    });
    expect(mockSupabase.from).toHaveBeenCalledWith('order_notification_outbox');
  });

  it('honors an explicit bounded batch size for manual drains', async () => {
    const response = await GET(
      cronRequest('/api/cron/order-notifications?batchSize=7')
    );

    expect(response.status).toBe(200);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'claim_order_notification_outbox',
      expect.objectContaining({ p_batch_size: 7 })
    );
  });

  it('dispatches manual documents through the authenticated cron worker', async () => {
    const row = {
      claim_owner: 'web-cron-test',
      attempt_count: 1,
      event_type: 'manual_order_receipt',
      id: 'outbox-manual-1',
      max_attempts: 5,
      merchant_id: 'merchant-1',
      order_id: 'order-manual-1',
    };
    mockSupabase.rpc.mockResolvedValueOnce({ data: [row], error: null });

    const response = await GET(cronRequest());

    expect(response.status).toBe(200);
    expect(mockSendManualOrderDocument).toHaveBeenCalledWith({
      supabase: mockSupabase,
      row: expect.objectContaining(row),
    });
    expect(sendOrderFulfillmentNotification).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      claimed: 1,
      sent: 1,
      success: true,
    });
  });

  it('clamps oversized batch sizes', async () => {
    await GET(cronRequest('/api/cron/order-notifications?batchSize=999'));
    expect(mockSupabase.rpc).toHaveBeenLastCalledWith(
      'claim_order_notification_outbox',
      expect.objectContaining({ p_batch_size: 10 })
    );
  });

  it('returns 400 for malformed batch sizes', async () => {
    const response = await GET(
      cronRequest('/api/cron/order-notifications?batchSize=invalid')
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid batch size',
    });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('serializes claimed events for the same order while allowing different orders to proceed', async () => {
    const orderOneShipped = {
      claim_owner: 'web-cron-test',
      attempt_count: 1,
      event_type: 'order_shipped',
      id: 'outbox-order-1-shipped',
      max_attempts: 5,
      merchant_id: 'merchant-1',
      order_id: 'order-1',
    };
    const orderOneDelivered = {
      claim_owner: 'web-cron-test',
      attempt_count: 1,
      event_type: 'order_delivered',
      id: 'outbox-order-1-delivered',
      max_attempts: 5,
      merchant_id: 'merchant-1',
      order_id: 'order-1',
    };
    const orderTwoShipped = {
      claim_owner: 'web-cron-test',
      attempt_count: 1,
      event_type: 'order_shipped',
      id: 'outbox-order-2-shipped',
      max_attempts: 5,
      merchant_id: 'merchant-1',
      order_id: 'order-2',
    };
    const callsStarted: string[] = [];
    let resolveFirstOrderSend: (() => void) | undefined;

    mockSupabase.rpc.mockResolvedValueOnce({
      data: [orderOneShipped, orderOneDelivered, orderTwoShipped],
      error: null,
    });
    mockSendOrderFulfillmentNotification.mockReset();
    mockSendOrderFulfillmentNotification.mockImplementation(
      async ({ eventType, orderId }) => {
        const callKey = `${orderId}:${eventType}`;
        callsStarted.push(callKey);
        if (callKey === 'order-1:order_shipped') {
          await new Promise<void>((resolve) => {
            resolveFirstOrderSend = resolve;
          });
        }
        return { status: 'sent', messageId: `${callKey}:message` };
      }
    );

    const responsePromise = GET(
      cronRequest('/api/cron/order-notifications?batchSize=3')
    );
    await vi.waitFor(() => {
      expect(callsStarted).toContain('order-1:order_shipped');
      expect(callsStarted).toContain('order-2:order_shipped');
    });

    expect(callsStarted).not.toContain('order-1:order_delivered');
    resolveFirstOrderSend?.();

    const response = await responsePromise;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ claimed: 3, sent: 3, success: true });
    expect(callsStarted.indexOf('order-1:order_shipped')).toBeLessThan(
      callsStarted.indexOf('order-1:order_delivered')
    );
  });

  it('reschedules retryable failures instead of failing the cron batch', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: [
        {
          claim_owner: 'web-cron-test',
          attempt_count: 2,
          event_type: 'order_delivered',
          id: 'outbox-3',
          max_attempts: 5,
          merchant_id: 'merchant-1',
          order_id: 'order-3',
        },
      ],
      error: null,
    });
    mockSendOrderFulfillmentNotification.mockReset();
    mockSendOrderFulfillmentNotification.mockResolvedValueOnce({
      status: 'failed',
      error: 'provider down',
    });

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ failed: 0, retried: 1, success: true });
    const updateBuilder = mockSupabase.from.mock.results[0]?.value;
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_error: 'provider down',
        status: 'pending',
      })
    );
  });

  it('does not retry when the provider may already have accepted the email', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: [
        {
          claim_owner: 'web-cron-test',
          attempt_count: 1,
          event_type: 'order_delivered',
          id: 'outbox-unknown',
          max_attempts: 5,
          merchant_id: 'merchant-1',
          order_id: 'order-unknown',
        },
      ],
      error: null,
    });
    mockSendOrderFulfillmentNotification.mockReset();
    mockSendOrderFulfillmentNotification.mockResolvedValueOnce({
      status: 'failed',
      deliveryOutcome: 'unknown',
      error: 'ZeptoMail request timed out after 30000ms',
    });

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ skipped: 1, retried: 0, success: true });
    const updateBuilder = mockSupabase.from.mock.results[0]?.value;
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        next_attempt_at: null,
        skip_reason: 'delivery_outcome_unknown',
        status: 'skipped',
      })
    );
  });

  it('marks exhausted failed notifications as terminal failed', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: [
        {
          claim_owner: 'web-cron-test',
          attempt_count: 5,
          event_type: 'order_delivered',
          id: 'outbox-4',
          max_attempts: 5,
          merchant_id: 'merchant-1',
          order_id: 'order-4',
        },
      ],
      error: null,
    });
    mockSendOrderFulfillmentNotification.mockReset();
    mockSendOrderFulfillmentNotification.mockResolvedValueOnce({
      status: 'failed',
      error: 'provider down',
    });

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ failed: 1, retried: 0, success: true });
    const updateBuilder = mockSupabase.from.mock.results[0]?.value;
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_error: 'provider down',
        next_attempt_at: null,
        status: 'failed',
      })
    );
  });

  it('records an unknown outcome when the sent marker cannot be persisted', async () => {
    const updateBuilder = createUpdateBuilder();
    updateBuilder.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'database unavailable' },
    });
    mockSupabase.from.mockReturnValue(updateBuilder);
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          claim_owner: 'web-cron-test',
          attempt_count: 1,
          event_type: 'order_shipped',
          id: 'outbox-persist-failure',
          max_attempts: 5,
          merchant_id: 'merchant-1',
          order_id: 'order-persist-failure',
        },
      ],
      error: null,
    });
    mockSendOrderFulfillmentNotification.mockReset();
    mockSendOrderFulfillmentNotification.mockResolvedValueOnce({
      status: 'sent',
      messageId: 'msg-persist-failure',
    });

    const response = await GET(cronRequest());

    expect(response.status).toBe(200);
    expect(updateBuilder.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        skip_reason: 'delivery_outcome_unknown',
        status: 'skipped',
      })
    );
  });

  it('returns 500 when neither sent nor unknown terminal state can be persisted', async () => {
    const updateBuilder = createUpdateBuilder();
    updateBuilder.maybeSingle
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'sent write failed' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'fallback write failed' },
      });
    mockSupabase.from.mockReturnValue(updateBuilder);
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          claim_owner: 'web-cron-test',
          attempt_count: 1,
          event_type: 'order_shipped',
          id: 'outbox-double-persist-failure',
          max_attempts: 5,
          merchant_id: 'merchant-1',
          order_id: 'order-double-persist-failure',
        },
      ],
      error: null,
    });
    mockSendOrderFulfillmentNotification.mockReset();
    mockSendOrderFulfillmentNotification.mockResolvedValueOnce({
      status: 'sent',
      messageId: 'msg-persist-failure',
    });

    const response = await GET(cronRequest());

    expect(response.status).toBe(500);
  });
});
