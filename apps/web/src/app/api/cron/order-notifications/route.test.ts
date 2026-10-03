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
    () => Promise<{
      data: { id: string; metadata?: Record<string, unknown> } | null;
      error: unknown;
    }>
  >(async () => ({ data: { id: matchedId }, error: null }));
  const builder = {
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
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

  it('treats a null claim payload as an empty batch', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ claimed: 0, success: true });
    expect(sendOrderFulfillmentNotification).not.toHaveBeenCalled();
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
});
