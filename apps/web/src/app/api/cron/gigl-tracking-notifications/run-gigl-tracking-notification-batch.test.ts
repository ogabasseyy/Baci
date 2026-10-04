import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/supabase';
import { runGiglTrackingNotificationBatch } from './run-gigl-tracking-notification-batch';

function clientWithRpc(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient<Database>;
}

describe('runGiglTrackingNotificationBatch', () => {
  it('claims the bounded batch and processes it with the shared worker', async () => {
    const notification = {
      audience: 'merchant',
      id: '00000000-0000-4000-8000-000000000001',
      merchant_id: '00000000-0000-4000-8000-000000000002',
      notification_kind: 'in_transit',
      order_id: '00000000-0000-4000-8000-000000000003',
      shipment_id: '00000000-0000-4000-8000-000000000005',
      tracking_event_id: '00000000-0000-4000-8000-000000000004',
    };
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [notification], error: null });
    const client = clientWithRpc(rpc);
    const processNotifications = vi.fn().mockResolvedValue({
      claimed: 1,
      failed: 0,
      sent: 0,
      skipped: 0,
      success: true,
    });

    const result = await runGiglTrackingNotificationBatch({
      batchSize: 10,
      client,
      processNotifications,
      workerId: 'gigl-notification-worker-1',
    });

    expect(rpc).toHaveBeenCalledWith('claim_shipment_tracking_notifications', {
      p_limit: 10,
      p_worker_id: 'gigl-notification-worker-1',
    });
    expect(processNotifications).toHaveBeenCalledWith(
      client,
      [notification],
      'gigl-notification-worker-1'
    );
    expect(result).toEqual({
      ok: true,
      summary: {
        claimed: 1,
        failed: 0,
        sent: 0,
        skipped: 0,
        success: true,
      },
    });
  });

  it('returns a bounded failure when the claim fails', async () => {
    const result = await runGiglTrackingNotificationBatch({
      batchSize: 10,
      client: clientWithRpc(
        vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'database internals' },
        })
      ),
      processNotifications: vi.fn(),
      workerId: 'gigl-notification-worker-2',
    });

    expect(result).toEqual({ ok: false, reason: 'claim_failed' });
  });

  it('does not process a malformed claim payload', async () => {
    const processNotifications = vi.fn();

    const result = await runGiglTrackingNotificationBatch({
      batchSize: 10,
      client: clientWithRpc(
        vi.fn().mockResolvedValue({ data: [{ id: 'invalid' }], error: null })
      ),
      processNotifications,
      workerId: 'gigl-notification-worker-3',
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_claim_payload' });
    expect(processNotifications).not.toHaveBeenCalled();
  });

  it('returns a bounded failure when notification processing throws', async () => {
    const result = await runGiglTrackingNotificationBatch({
      batchSize: 10,
      client: clientWithRpc(
        vi.fn().mockResolvedValue({ data: [], error: null })
      ),
      processNotifications: vi
        .fn()
        .mockRejectedValue(new Error('customer-linked detail')),
      workerId: 'gigl-notification-worker-4',
    });

    expect(result).toEqual({ ok: false, reason: 'worker_failed' });
  });
});
