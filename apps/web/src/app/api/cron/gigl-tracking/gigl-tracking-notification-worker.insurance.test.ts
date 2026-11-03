import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processClaimedGiglTrackingNotifications } from './gigl-tracking-notification-worker';

const maybeNotifyActivateProtection = vi.hoisted(() => vi.fn());
const notifyMerchant = vi.hoisted(() => vi.fn());
const notifyCustomer = vi.hoisted(() => vi.fn());

vi.mock('@/lib/insurance/notify-activate-protection', () => ({
  maybeNotifyActivateProtection,
}));
vi.mock('@/lib/expo-push', () => ({ notifyCustomer, notifyMerchant }));

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

function supabaseFor(event: unknown) {
  const builder = {
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue({ data: event, error: null }),
    select: vi.fn(() => builder),
  };
  const from = vi.fn().mockReturnValue(builder);
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  return { from, rpc };
}

describe('GIGL delivered notification protection fanout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maybeNotifyActivateProtection.mockResolvedValue(undefined);
    notifyMerchant.mockResolvedValue({ errors: [], failed: 0, sent: 1 });
    notifyCustomer.mockResolvedValue({ errors: [], failed: 0, sent: 1 });
  });

  it('fans out protection activation from the notification worker', async () => {
    const supabase = supabaseFor({
      description: 'Delivered',
      customer_id: 'c1',
      user_id: 'u1',
    });

    const summary = await processClaimedGiglTrackingNotifications(
      supabase as never,
      [notification],
      'worker'
    );

    expect(summary).toMatchObject({ failed: 0, sent: 1 });
    expect(maybeNotifyActivateProtection).toHaveBeenCalledWith(
      notification.order_id,
      notification.merchant_id
    );
    expect(notifyCustomer).toHaveBeenCalled();
  });

  it('does not repeat the protection prompt for the merchant delivered alert', async () => {
    const supabase = supabaseFor({ description: 'Delivered' });
    await processClaimedGiglTrackingNotifications(
      supabase as never,
      [merchantNotification],
      'worker'
    );
    expect(maybeNotifyActivateProtection).not.toHaveBeenCalled();
    expect(notifyMerchant).toHaveBeenCalled();
  });

  it('keeps delivery notification completion successful when protection fanout fails', async () => {
    maybeNotifyActivateProtection.mockRejectedValueOnce(
      new Error('push unavailable')
    );
    const supabase = supabaseFor({
      description: 'Delivered',
      customer_id: 'c1',
      user_id: 'u1',
    });

    const summary = await processClaimedGiglTrackingNotifications(
      supabase as never,
      [notification],
      'worker'
    );

    expect(summary).toMatchObject({ failed: 0, sent: 1 });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'complete_shipment_tracking_notification',
      expect.objectContaining({ p_outcome: 'sent' })
    );
  });
});
