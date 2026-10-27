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
    // Claim RPC only: the malformed row never reaches the dead-letter RPC.
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(1);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('dead-letters manual rows missing identity through the scoped RPC', async () => {
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
    mockSupabase.rpc.mockResolvedValueOnce({ data: true, error: null });

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      claimed: 1,
      skipped: 1,
      success: true,
      unparseable: 1,
    });
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'dead_letter_corrupt_outbox_row',
      {
        p_outbox_id: 'outbox-corrupt-early',
        p_worker_id: expect.any(String),
      }
    );
    // No generic table write: terminalization happens inside the RPC.
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it.each([
    ['rpc-decline', { data: false, error: null }],
    ['rpc-error', { data: null, error: new Error('rpc unavailable') }],
  ])('loops when the dead-letter RPC does not terminalize (%s)', async (_case, rpcResult) => {
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
    mockSupabase.rpc.mockResolvedValueOnce(rpcResult);

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
    // The RPC re-verifies stored identities server-side and declines.
    mockSupabase.rpc.mockResolvedValueOnce({ data: false, error: null });

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      claimed: 1,
      skipped: 0,
      unparseable: 1,
    });
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'dead_letter_corrupt_outbox_row',
      {
        p_outbox_id: 'outbox-projection-glitch',
        p_worker_id: expect.any(String),
      }
    );
    expect(mockSupabase.from).not.toHaveBeenCalled();
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
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(1);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});
