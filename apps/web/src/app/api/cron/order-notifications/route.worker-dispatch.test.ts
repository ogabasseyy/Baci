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
import { GET } from './route';

function cronRequest(path = '/api/cron/order-notifications') {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: { Authorization: 'Bearer secret' },
    method: 'GET',
  });
}

function createUpdateBuilder() {
  let matchedId = '';
  const maybeSingle = vi.fn<
    () => Promise<{
      data: { id: string; metadata?: Record<string, unknown> } | null;
      error: unknown;
    }>
  >(async () => ({ data: { id: matchedId }, error: null }));
  const builder = {
    match: vi.fn((values: { id: string }) => {
      matchedId = values.id;
      return builder;
    }),
    maybeSingle,
    not: vi.fn(() => builder),
    select: vi.fn(() => builder),
    update: vi.fn(() => builder),
  };
  return builder;
}

describe('GET /api/cron/order-notifications worker dispatch', () => {
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
});
