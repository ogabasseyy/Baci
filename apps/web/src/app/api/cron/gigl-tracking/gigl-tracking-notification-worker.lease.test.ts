import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processClaimedGiglTrackingNotifications } from './gigl-tracking-notification-worker';
import {
  createGiglTrackingNotificationSupabase,
  giglTrackingNotificationTestNotification,
} from './gigl-tracking-notification-worker.test-support';

const notifyMerchant = vi.hoisted(() => vi.fn());
const notifyCustomer = vi.hoisted(() => vi.fn());
vi.mock('@/lib/expo-client', () => ({ getExpoClient: vi.fn() }));
vi.mock('@/lib/expo-push-core', () => ({
  notifyCustomerWithStore: (_store: unknown, ...args: unknown[]) =>
    notifyCustomer(...args),
  notifyMerchantWithStore: (_store: unknown, ...args: unknown[]) =>
    notifyMerchant(...args),
}));

const notification = giglTrackingNotificationTestNotification;

describe('GIGL notification worker lease-bound wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifyMerchant.mockResolvedValue({ errors: [], failed: 0, sent: 1 });
    notifyCustomer.mockResolvedValue({ errors: [], failed: 0, sent: 1 });
  });

  it('reads the event and customer only through lease-keyed wrappers', async () => {
    const supabase = createGiglTrackingNotificationSupabase(
      { description: 'Delivered' },
      { customer_id: 'c' },
      { user_id: 'u' }
    );

    await processClaimedGiglTrackingNotifications(
      supabase as never,
      [
        {
          ...notification,
          audience: 'customer',
          notification_kind: 'delivered',
        },
      ],
      'worker'
    );

    const names = supabase.rpc.mock.calls.map(([name]) => name);
    expect(names).toEqual(
      expect.arrayContaining([
        'gigl_worker_notification_event',
        'gigl_worker_notification_customer',
        'gigl_worker_complete_notification',
      ])
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'gigl_worker_notification_event',
      {
        p_id: notification.id,
        p_worker_id: 'worker',
      }
    );
    expect(supabase).not.toHaveProperty('from');
  });

  it('defers rejection completion until the push helper finishes persisting', async () => {
    const supabase = createGiglTrackingNotificationSupabase({
      description: 'Rider assigned',
    });
    let completionsBeforeReturn = -1;
    notifyMerchant.mockImplementation(
      async (_merchantId, _title, _body, _payload, _channel, options) => {
        await options?.onDeliveryStart?.();
        await options?.onDeliveryRejected?.();
        completionsBeforeReturn = supabase.rpc.mock.calls.filter(
          ([name]) => name === 'gigl_worker_complete_notification'
        ).length;
        return { errors: ['DeviceNotRegistered'], failed: 1, sent: 0 };
      }
    );

    const summary = await processClaimedGiglTrackingNotifications(
      supabase as never,
      [notification],
      'worker'
    );

    expect(completionsBeforeReturn).toBe(0);
    expect(summary.failed).toBe(1);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'gigl_worker_complete_notification',
      expect.objectContaining({
        p_error: 'all_push_tickets_rejected',
        p_outcome: 'rejected',
      })
    );
  });
});
