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
    select: vi.fn(() => builder),
    update: vi.fn(() => builder),
  };
  return builder;
}

describe('GET /api/cron/order-notifications outcome persistence', () => {
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

  it('merges completion metadata into the live row instead of the claim copy', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          claim_owner: 'web-cron-test',
          attempt_count: 1,
          event_type: 'manual_order_receipt',
          id: 'outbox-manual',
          max_attempts: 5,
          merchant_id: 'merchant-1',
          order_id: 'order-1',
          metadata: { source: 'manual_order_document' },
        },
      ],
      error: null,
    });
    const builder = createUpdateBuilder();
    builder.maybeSingle.mockResolvedValueOnce({
      data: {
        id: 'outbox-manual',
        metadata: {
          source: 'manual_order_document',
          sent_document_kind: 'proforma_invoice',
        },
      },
      error: null,
    });
    mockSupabase.from.mockReturnValue(builder);

    const response = await GET(cronRequest());

    expect(response.status).toBe(200);
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'sent',
        metadata: {
          source: 'manual_order_document',
          sent_document_kind: 'proforma_invoice',
          message_id: 'manual-document-1',
        },
      })
    );
  });
});
