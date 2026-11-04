import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processClaimedGiglTrackingNotifications } from './gigl-tracking-notification-worker';
import { createGiglTrackingNotificationSupabase } from './gigl-tracking-notification-worker.test-support';

const notifyGiglDeliveredProtection = vi.hoisted(() => vi.fn());
const notifyMerchant = vi.hoisted(() => vi.fn());
const notifyCustomer = vi.hoisted(() => vi.fn());

vi.mock('./gigl-tracking-delivered-protection', () => ({
  notifyGiglDeliveredProtection,
}));
vi.mock('@/lib/expo-client', () => ({ getExpoClient: vi.fn() }));
vi.mock('@/lib/expo-push-core', () => ({
  notifyCustomerWithStore: (_store: unknown, ...args: unknown[]) =>
    notifyCustomer(...args),
  notifyMerchantWithStore: (_store: unknown, ...args: unknown[]) =>
    notifyMerchant(...args),
}));

const merchantNotification = {
  audience: 'merchant' as const,
  id: '00000000-0000-4000-8000-000000000001',
  merchant_id: '00000000-0000-4000-8000-000000000002',
  notification_kind: 'delivered',
  order_id: '00000000-0000-4000-8000-000000000003',
  recipient_user_ids: ['00000000-0000-4000-8000-0000000000a1'],
  shipment_id: '00000000-0000-4000-8000-000000000005',
  tracking_event_id: '00000000-0000-4000-8000-000000000004',
};

const notification = { ...merchantNotification, audience: 'customer' as const };

function supabaseFor() {
  return createGiglTrackingNotificationSupabase(
    { description: 'Delivered' },
    { customer_id: 'c1' },
    { user_id: 'u1' }
  );
}

describe('GIGL delivered notification protection fanout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notifyGiglDeliveredProtection.mockResolvedValue(undefined);
    notifyMerchant.mockResolvedValue({ errors: [], failed: 0, sent: 1 });
    notifyCustomer.mockResolvedValue({ errors: [], failed: 0, sent: 1 });
  });

  it('fans out protection activation from the notification worker', async () => {
    const supabase = supabaseFor();

    const summary = await processClaimedGiglTrackingNotifications(
      supabase as never,
      [notification],
      'worker'
    );

    expect(summary).toMatchObject({ failed: 0, sent: 1 });
    expect(notifyGiglDeliveredProtection).toHaveBeenCalledWith(
      supabase,
      { notificationId: notification.id, workerId: 'worker' },
      notification.merchant_id,
      notification.order_id
    );
    expect(notifyCustomer).toHaveBeenCalled();
  });

  it('does not repeat the protection prompt for the merchant delivered alert', async () => {
    const supabase = supabaseFor();
    await processClaimedGiglTrackingNotifications(
      supabase as never,
      [merchantNotification],
      'worker'
    );
    expect(notifyGiglDeliveredProtection).not.toHaveBeenCalled();
    expect(notifyMerchant).toHaveBeenCalled();
  });

  it('keeps delivery notification completion successful when protection fanout fails', async () => {
    notifyGiglDeliveredProtection.mockRejectedValueOnce(
      new Error('push unavailable')
    );
    const supabase = supabaseFor();

    const summary = await processClaimedGiglTrackingNotifications(
      supabase as never,
      [notification],
      'worker'
    );

    expect(summary).toMatchObject({ failed: 0, sent: 1 });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'gigl_worker_complete_notification',
      expect.objectContaining({ p_outcome: 'sent' })
    );
  });
});
