import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processClaimedGiglTrackingNotifications } from './gigl-tracking-notification-worker';

import { createGiglTrackingNotificationSupabase } from './gigl-tracking-notification-worker.test-support';

const notifyMerchant = vi.hoisted(() => vi.fn());
const notifyCustomer = vi.hoisted(() => vi.fn());
vi.mock('@/lib/expo-client', () => ({ getExpoClient: vi.fn() }));
vi.mock('@/lib/expo-push-core', () => ({
  notifyCustomerWithStore: (_store: unknown, ...args: unknown[]) =>
    notifyCustomer(...args),
  notifyMerchantWithStore: (_store: unknown, ...args: unknown[]) =>
    notifyMerchant(...args),
}));

const notification = {
  audience: 'merchant' as const,
  id: '00000000-0000-4000-8000-000000000001',
  merchant_id: '00000000-0000-4000-8000-000000000002',
  notification_kind: 'pickup_en_route',
  order_id: '00000000-0000-4000-8000-000000000003',
  recipient_user_ids: ['00000000-0000-4000-8000-0000000000a1'],
  shipment_id: '00000000-0000-4000-8000-000000000005',
  tracking_event_id: '00000000-0000-4000-8000-000000000004',
};

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
    const supabase = createGiglTrackingNotificationSupabase({
      description: 'Rider assigned',
      raw_status: 'MAPT',
    });
    const defaultRpc = supabase.rpc.getMockImplementation();
    supabase.rpc.mockImplementation((rpcName: string, arguments_: unknown) => {
      const argumentsRecord = arguments_ as { p_id?: string };
      if (
        rpcName === 'gigl_worker_complete_notification' &&
        argumentsRecord.p_id === notification.id
      ) {
        return Promise.resolve({
          data: null,
          error: { message: 'lease lost' },
        });
      }
      return defaultRpc?.(rpcName, arguments_);
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
