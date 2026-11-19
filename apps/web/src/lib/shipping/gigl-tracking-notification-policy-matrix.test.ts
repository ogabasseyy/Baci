import { describe, expect, it } from 'vitest';
import {
  GIGL_TRACKING_NOTIFICATION_AUDIENCES,
  GIGL_TRACKING_NOTIFICATION_KINDS,
  GIGL_TRACKING_NOTIFICATION_POLICY_MATRIX,
  getGiglTrackingNotificationPolicies,
} from './gigl-tracking-notification-policy-matrix';

describe('GIGL tracking notification policy matrix', () => {
  it('uses one valid selector and a supported audience and kind for every policy', () => {
    const tuples = new Set<string>();

    for (const policy of GIGL_TRACKING_NOTIFICATION_POLICY_MATRIX) {
      expect('rawStatus' in policy).not.toBe('normalizedStatus' in policy);
      expect(GIGL_TRACKING_NOTIFICATION_AUDIENCES).toContain(policy.audience);
      expect(GIGL_TRACKING_NOTIFICATION_KINDS).toContain(
        policy.notificationKind
      );
      if ('rawStatus' in policy) {
        expect(policy.rawStatus).toBe(policy.rawStatus.toUpperCase());
      } else {
        expect(policy.normalizedStatus).toBe(
          policy.normalizedStatus.toLowerCase()
        );
      }

      const selector =
        'rawStatus' in policy
          ? `raw:${policy.rawStatus}`
          : `normalized:${policy.normalizedStatus}`;
      const tuple = `${selector}:${policy.audience}:${policy.notificationKind}`;
      expect(tuples.has(tuple)).toBe(false);
      tuples.add(tuple);
    }
  });

  it('uses explicit raw status policies before normalized-status policies', () => {
    expect(
      getGiglTrackingNotificationPolicies(
        ' rider en route for pickup ',
        'pickup_scheduled'
      )
    ).toEqual([
      {
        audience: 'merchant',
        rawStatus: 'RIDER EN ROUTE FOR PICKUP',
        notificationKind: 'pickup_en_route',
      },
    ]);
  });

  it('returns all normalized policies when no raw-specific policy exists', () => {
    expect(
      getGiglTrackingNotificationPolicies('Delivery failed', 'failed')
    ).toEqual([
      {
        audience: 'merchant',
        normalizedStatus: 'failed',
        notificationKind: 'failed',
      },
      {
        audience: 'customer',
        normalizedStatus: 'failed',
        notificationKind: 'delivery_attempt_failed',
      },
    ]);
  });

  it('does not emit notifications for unrecognized non-actionable status', () => {
    expect(
      getGiglTrackingNotificationPolicies('Shipment created', 'pending')
    ).toEqual([]);
  });

  describe('approved merchant/customer map', () => {
    const pairs = (
      raw: string,
      status: Parameters<typeof getGiglTrackingNotificationPolicies>[1]
    ) =>
      getGiglTrackingNotificationPolicies(raw, status).map(
        (p) => `${p.audience}:${p.notificationKind}`
      );

    it('sends nothing at booking', () => {
      expect(pairs('CRT', 'booked')).toEqual([]);
    });
    it('alerts only the merchant when pickup is scheduled', () => {
      expect(pairs('MAPT', 'pickup_scheduled')).toEqual([
        'merchant:pickup_assigned',
      ]);
    });
    it('alerts only the merchant with pickup_delayed for raw DLP', () => {
      expect(pairs('DLP', 'pickup_scheduled')).toEqual([
        'merchant:pickup_delayed',
      ]);
    });
    it('tells both sides at pickup', () => {
      expect(pairs('MPIK', 'picked_up')).toEqual([
        'merchant:picked_up',
        'customer:picked_up',
      ]);
    });
    it('tells only the customer in transit', () => {
      expect(pairs('MSVC', 'in_transit')).toEqual(['customer:transit_started']);
    });
    it('tells both sides out for delivery', () => {
      expect(pairs('MSHC', 'out_for_delivery')).toEqual([
        'merchant:out_for_delivery',
        'customer:out_for_delivery',
      ]);
    });
    it('tells both sides on delivery', () => {
      expect(pairs('MAHD', 'delivered')).toEqual([
        'merchant:delivered',
        'customer:delivered',
      ]);
    });
    it('tells both sides on cancellation', () => {
      expect(pairs('MSCC', 'cancelled')).toEqual([
        'merchant:cancelled',
        'customer:cancelled',
      ]);
    });
  });
});
