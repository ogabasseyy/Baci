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

function createUpdateBuilder(
  storedIdentities: {
    event_type: string;
    merchant_id: string | null;
    order_id: string | null;
  } | null = {
    event_type: 'manual_order_receipt',
    merchant_id: null,
    order_id: null,
  }
) {
  let matchedId = '';
  const select = vi.fn();
  const maybeSingle = vi.fn<
    () => Promise<{
      data: {
        id: string;
        metadata?: Record<string, unknown>;
        event_type?: string;
        merchant_id?: string | null;
        order_id?: string | null;
      } | null;
      error: unknown;
    }>
  >(async () => {
    const calls = select.mock.calls;
    // The dead-letter path re-reads stored identities before terminalizing;
    // answer that projection from the per-test stored row.
    if (calls[calls.length - 1]?.[0] === 'event_type, merchant_id, order_id') {
      return {
        data: storedIdentities && {
          id: matchedId,
          ...storedIdentities,
        },
        error: null,
      };
    }
    return { data: { id: matchedId }, error: null };
  });
  const builder = {
    match: vi.fn((values: { id: string }) => {
      matchedId = values.id;
      return builder;
    }),
    maybeSingle,
    select,
    update: vi.fn(() => builder),
  };
  select.mockImplementation(() => builder);
  return builder;
}

describe('GET /api/cron/order-notifications dead-letter', () => {
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

  it('loops corrupt rows with a malformed event type instead of dead-lettering', async () => {
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
      skipped: 0,
      unparseable: 1,
    });
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('dead-letters manual rows missing identity on first observation without an attempt threshold', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          attempt_count: 1,
          event_type: 'manual_order_receipt',
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
      skipped: 1,
      success: true,
      unparseable: 1,
    });
    const updateBuilder = mockSupabase.from.mock.results[0]?.value;
    expect(mockSupabase.from).toHaveBeenCalledWith('order_notification_outbox');
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch_started_at: null,
        next_attempt_at: null,
        skip_reason: 'unparseable',
        status: 'skipped',
      })
    );
    expect(updateBuilder.match).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'outbox-corrupt-early',
        status: 'processing',
      })
    );
  });

  it.each([
    [{ merchant_id: null, order_id: 'order-1' }],
    [{ merchant_id: 'merchant-1', order_id: null }],
  ])('dead-letters stored rows missing exactly one identity (%#)', async (storedIdentity) => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          attempt_count: 1,
          event_type: 'manual_order_receipt',
          id: 'outbox-half-corrupt',
          max_attempts: 5,
        },
      ],
      error: null,
    });
    mockSupabase.from.mockReturnValue(
      createUpdateBuilder({
        event_type: 'manual_order_receipt',
        ...storedIdentity,
      })
    );

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      claimed: 1,
      skipped: 1,
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

  it('loops when the claim projection drops fields the stored row still has', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [
        {
          attempt_count: 1,
          event_type: 'manual_order_receipt',
          id: 'outbox-projection-glitch',
          max_attempts: 5,
        },
      ],
      error: null,
    });
    mockSupabase.from.mockReturnValue(
      createUpdateBuilder({
        event_type: 'manual_order_receipt',
        merchant_id: 'merchant-1',
        order_id: 'order-1',
      })
    );

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      claimed: 1,
      skipped: 0,
      unparseable: 1,
    });
    const updateBuilder = mockSupabase.from.mock.results[0]?.value;
    expect(updateBuilder.select).toHaveBeenCalledWith(
      'event_type, merchant_id, order_id'
    );
    expect(updateBuilder.update).not.toHaveBeenCalled();
  });

  it('never dead-letters shipping rows missing identity fields', async () => {
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
      skipped: 0,
      unparseable: 1,
    });
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});
