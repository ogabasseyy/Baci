import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processClaimedGiglTrackingNotifications } from './gigl-tracking-notification-worker';
import {
  createGiglTrackingNotificationSupabase,
  giglTrackingNotificationTestNotification,
} from './gigl-tracking-notification-worker.test-support';

const notifyMerchant = vi.hoisted(() => vi.fn());
const notifyCustomer = vi.hoisted(() => vi.fn());
vi.mock('@/lib/expo-push', () => ({ notifyCustomer, notifyMerchant }));

const notification = giglTrackingNotificationTestNotification;

describe('processClaimedGiglTrackingNotifications orderless repair pickups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifyMerchant.mockResolvedValue({ errors: [], failed: 0, sent: 1 });
    notifyCustomer.mockResolvedValue({ errors: [], failed: 0, sent: 1 });
  });

  it('bugfix: skips orderless repair-pickup customer claims without requiring an order', async () => {
    const supabase = createGiglTrackingNotificationSupabase({
      description: 'Delivered',
      raw_status: 'DELIVERED',
    });
    const summary = await processClaimedGiglTrackingNotifications(
      supabase as never,
      [{ ...notification, audience: 'customer', order_id: null }],
      'worker'
    );

    expect(summary.skipped).toBe(1);
    expect(notifyCustomer).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledWith(
      'complete_shipment_tracking_notification',
      expect.objectContaining({
        p_error: 'orderless_repair_pickup',
        p_outcome: 'skipped',
      })
    );
  });

  it('bugfix: merchant orderless claims notify with claim-projected repair identity', async () => {
    const repairId = '00000000-0000-4000-8000-000000000099';
    const supabase = createGiglTrackingNotificationSupabase({
      description: 'Rider assigned',
      raw_status: 'RIDER EN ROUTE FOR PICKUP',
    });
    const summary = await processClaimedGiglTrackingNotifications(
      supabase as never,
      [{ ...notification, order_id: null, repair_id: repairId }],
      'worker'
    );

    expect(summary.sent).toBe(1);
    expect(supabase.from).not.toHaveBeenCalledWith('repairs');
    expect(notifyMerchant).toHaveBeenCalledWith(
      notification.merchant_id,
      'Rider en route',
      expect.any(String),
      {
        repairId,
        type: 'repair',
      },
      'orders',
      expect.any(Object)
    );
  });
});
