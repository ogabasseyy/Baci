import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGiglTrackingMerchantPushPayload } from './build-gigl-tracking-merchant-push-payload';
import { giglTrackingNotificationTestNotification } from './gigl-tracking-notification-worker.test-support';

const notification = giglTrackingNotificationTestNotification;

describe('buildGiglTrackingMerchantPushPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps order-backed shipment_tracking payloads unchanged', () => {
    const payload = buildGiglTrackingMerchantPushPayload(notification);

    expect(payload).toEqual({
      orderId: notification.order_id,
      type: 'shipment_tracking',
    });
  });

  it('bugfix: orderless merchant pushes use claim-projected repairId without repairs reads', () => {
    const repairId = '00000000-0000-4000-8000-000000000099';
    const payload = buildGiglTrackingMerchantPushPayload({
      ...notification,
      order_id: null,
      repair_id: repairId,
    });

    expect(payload).toEqual({ type: 'repair', repairId });
  });

  it('falls back to type repair with shipmentId when no repair is projected', () => {
    const payload = buildGiglTrackingMerchantPushPayload({
      ...notification,
      order_id: null,
      repair_id: null,
    });

    expect(payload).toEqual({
      type: 'repair',
      shipmentId: notification.shipment_id,
    });
  });
});
