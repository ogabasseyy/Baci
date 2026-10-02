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
    select: vi.fn(() => builder),
    update: vi.fn(() => builder),
  };
  return builder;
}

describe('GET /api/cron/order-notifications claim parsing', () => {
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

  it('leaves soft-corrupt rows for lease expiry when delivery identity survives', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          attempt_count: 'x',
          claim_owner: 123,
          event_type: 'order_shipped',
          id: 'outbox-soft-corrupt',
          max_attempts: 5,
          merchant_id: 'merchant-1',
          order_id: 'order-1',
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
});
