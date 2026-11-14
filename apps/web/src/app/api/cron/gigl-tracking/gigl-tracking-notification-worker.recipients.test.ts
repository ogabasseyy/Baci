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

describe('processClaimedGiglTrackingNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifyMerchant.mockResolvedValue({ errors: [], failed: 0, sent: 1 });
    notifyCustomer.mockResolvedValue({ errors: [], failed: 0, sent: 1 });
  });

  describe('merchant recipients and audience copy', () => {
    it('limits merchant pushes to the claimed owner/fulfil-staff recipients', async () => {
      const recipients = [
        '00000000-0000-4000-8000-0000000000a1',
        '00000000-0000-4000-8000-0000000000a2',
      ];
      const supabase = createGiglTrackingNotificationSupabase({
        description: 'Picked up',
        raw_status: 'MPIK',
      });
      await processClaimedGiglTrackingNotifications(
        supabase as never,
        [
          {
            ...notification,
            notification_kind: 'picked_up',
            recipient_user_ids: recipients,
          },
        ],
        'worker'
      );
      expect(notifyMerchant).toHaveBeenCalledWith(
        notification.merchant_id,
        'Order picked up',
        expect.any(String),
        expect.any(Object),
        'orders',
        expect.objectContaining({ recipientUserIds: recipients })
      );
    });

    it('bugfix: defers without consuming an attempt or broadcasting when the claim omits recipient_user_ids', async () => {
      const supabase = createGiglTrackingNotificationSupabase({
        description: 'Picked up',
        raw_status: 'MPIK',
      });
      const summary = await processClaimedGiglTrackingNotifications(
        supabase as never,
        [{ ...notification, recipient_user_ids: null }],
        'worker'
      );
      expect(summary).toMatchObject({ failed: 0, skipped: 1, sent: 0 });
      expect(notifyMerchant).not.toHaveBeenCalled();
      // The lease is left to expire: no attempt is consumed.
      const names = supabase.rpc.mock.calls.map(([name]) => name);
      expect(names).not.toContain('gigl_worker_begin_notification_dispatch');
      expect(names).not.toContain('gigl_worker_complete_notification');
    });

    it('sends nobody when no owner or fulfil staff qualifies', async () => {
      const supabase = createGiglTrackingNotificationSupabase({
        description: 'Picked up',
        raw_status: 'MPIK',
      });
      await processClaimedGiglTrackingNotifications(
        supabase as never,
        [{ ...notification, recipient_user_ids: [] }],
        'worker'
      );
      expect(notifyMerchant).toHaveBeenCalledWith(
        notification.merchant_id,
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        'orders',
        expect.objectContaining({ recipientUserIds: [] })
      );
    });

    it('uses the sale-complete copy for the merchant delivered push', async () => {
      const supabase = createGiglTrackingNotificationSupabase({
        description: 'Delivered',
        raw_status: 'MAHD',
      });
      await processClaimedGiglTrackingNotifications(
        supabase as never,
        [{ ...notification, notification_kind: 'delivered' }],
        'worker'
      );
      expect(notifyMerchant).toHaveBeenCalledWith(
        notification.merchant_id,
        'Sale complete',
        expect.any(String),
        expect.any(Object),
        'orders',
        expect.any(Object)
      );
    });

    it('uses the has-shipped copy for the customer picked_up push', async () => {
      const supabase = createGiglTrackingNotificationSupabase(
        { description: 'Picked up', raw_status: 'MPIK' },
        { customer_id: '00000000-0000-4000-8000-000000000005' },
        { user_id: '00000000-0000-4000-8000-000000000006' }
      );
      await processClaimedGiglTrackingNotifications(
        supabase as never,
        [
          {
            ...notification,
            audience: 'customer',
            notification_kind: 'picked_up',
          },
        ],
        'worker'
      );
      expect(notifyCustomer).toHaveBeenCalledWith(
        '00000000-0000-4000-8000-000000000006',
        'Your order has shipped',
        expect.any(String),
        expect.objectContaining({ type: 'shipment_tracking' }),
        'orders',
        expect.any(Object)
      );
    });
  });
});
