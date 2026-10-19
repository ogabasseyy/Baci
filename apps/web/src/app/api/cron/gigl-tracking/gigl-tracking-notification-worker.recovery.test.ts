import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processClaimedGiglTrackingNotifications } from './gigl-tracking-notification-worker';

const notifyMerchant = vi.hoisted(() => vi.fn());
const notifyCustomer = vi.hoisted(() => vi.fn());
vi.mock('@/lib/expo-push', () => ({ notifyCustomer, notifyMerchant }));

const notification = {
  audience: 'merchant' as const,
  id: '00000000-0000-4000-8000-000000000001',
  merchant_id: '00000000-0000-4000-8000-000000000002',
  notification_kind: 'pickup_en_route',
  order_id: '00000000-0000-4000-8000-000000000003',
  shipment_id: '00000000-0000-4000-8000-000000000005',
  tracking_event_id: '00000000-0000-4000-8000-000000000004',
};

function query(data: unknown) {
  const builder = {
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    select: vi.fn(() => builder),
  };
  return builder;
}

function supabaseFor(...rows: unknown[]) {
  const from = vi.fn().mockImplementation(() => query(rows.shift() ?? null));
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  return { from, rpc };
}

describe('GIGL notification failure recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifyMerchant.mockResolvedValue({ errors: [], failed: 0, sent: 1 });
    notifyCustomer.mockResolvedValue({ errors: [], failed: 0, sent: 1 });
  });

  it('continues processing later notifications when failure recovery loses its lease', async () => {
    notifyMerchant
      .mockRejectedValueOnce(new Error('Expo unavailable'))
      .mockResolvedValueOnce({ errors: [], failed: 0, sent: 1 });
    const supabase = supabaseFor(
      { description: 'Rider assigned', raw_status: 'MAPT' },
      { description: 'Delivered', raw_status: 'SHD' }
    );
    supabase.rpc.mockImplementation((rpcName: string, arguments_: unknown) => {
      const argumentsRecord = arguments_ as { p_id?: string };
      if (
        rpcName === 'complete_shipment_tracking_notification' &&
        argumentsRecord.p_id === notification.id
      ) {
        return Promise.resolve({
          data: null,
          error: { message: 'lease lost' },
        });
      }
      return Promise.resolve({ data: true, error: null });
    });

    const summary = await processClaimedGiglTrackingNotifications(
      supabase as never,
      [
        notification,
        {
          ...notification,
          id: '00000000-0000-4000-8000-000000000007',
          notification_kind: 'delivered',
        },
      ],
      'worker'
    );

    expect(summary).toMatchObject({ failed: 1, sent: 1, skipped: 0 });
  });
});
