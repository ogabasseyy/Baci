import type { NormalizedShipmentStatus } from './types';

export const GIGL_TRACKING_NOTIFICATION_AUDIENCES = [
  'merchant',
  'customer',
] as const;

export const GIGL_TRACKING_NOTIFICATION_KINDS = [
  'pickup_assigned',
  'pickup_en_route',
  'pickup_delayed',
  'picked_up',
  'transit_started',
  'arrived_in_city',
  'out_for_delivery',
  'delivered',
  'delivery_attempt_failed',
  'return_in_progress',
  'shipment_exception',
  'failed',
  'returned',
  'cancelled',
  'waybill_changed',
] as const;

export const GIGL_PICKUP_EN_ROUTE_RAW_STATUS = 'RIDER EN ROUTE FOR PICKUP';
/** Synthetic raw status for a parcel arriving at the destination centre/city. */
export const GIGL_ARRIVED_IN_CITY_RAW_STATUS = 'ARRIVED IN DESTINATION CITY';
/** GIG raw code for a delayed pickup; normalises to pickup_scheduled. */
export const GIGL_PICKUP_DELAYED_RAW_STATUS = 'DLP';

export type GiglTrackingNotificationAudience =
  (typeof GIGL_TRACKING_NOTIFICATION_AUDIENCES)[number];
export type GiglTrackingNotificationKind =
  (typeof GIGL_TRACKING_NOTIFICATION_KINDS)[number];

export type GiglTrackingNotificationPolicy = {
  audience: GiglTrackingNotificationAudience;
  notificationKind: GiglTrackingNotificationKind;
} & (
  | { rawStatus: string; normalizedStatus?: never }
  | { rawStatus?: never; normalizedStatus: NormalizedShipmentStatus }
);

export const GIGL_TRACKING_NOTIFICATION_POLICY_MATRIX = [
  {
    audience: 'merchant',
    normalizedStatus: 'pickup_scheduled',
    notificationKind: 'pickup_assigned',
  },
  {
    audience: 'merchant',
    rawStatus: GIGL_PICKUP_EN_ROUTE_RAW_STATUS,
    notificationKind: 'pickup_en_route',
  },
  {
    audience: 'merchant',
    rawStatus: GIGL_PICKUP_DELAYED_RAW_STATUS,
    notificationKind: 'pickup_delayed',
  },
  {
    audience: 'merchant',
    normalizedStatus: 'picked_up',
    notificationKind: 'picked_up',
  },
  {
    audience: 'customer',
    normalizedStatus: 'picked_up',
    notificationKind: 'picked_up',
  },
  {
    audience: 'customer',
    normalizedStatus: 'in_transit',
    notificationKind: 'transit_started',
  },
  {
    audience: 'customer',
    rawStatus: GIGL_ARRIVED_IN_CITY_RAW_STATUS,
    notificationKind: 'arrived_in_city',
  },
  {
    // Raw policies override normalized ones, so an arrival that is the first
    // in-transit signal must still send transit_started (deduped per shipment).
    audience: 'customer',
    rawStatus: GIGL_ARRIVED_IN_CITY_RAW_STATUS,
    notificationKind: 'transit_started',
  },
  {
    audience: 'merchant',
    normalizedStatus: 'out_for_delivery',
    notificationKind: 'out_for_delivery',
  },
  {
    audience: 'customer',
    normalizedStatus: 'out_for_delivery',
    notificationKind: 'out_for_delivery',
  },
  {
    audience: 'merchant',
    normalizedStatus: 'delivered',
    notificationKind: 'delivered',
  },
  {
    audience: 'customer',
    normalizedStatus: 'delivered',
    notificationKind: 'delivered',
  },
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
  {
    audience: 'merchant',
    normalizedStatus: 'returned',
    notificationKind: 'returned',
  },
  {
    audience: 'customer',
    normalizedStatus: 'returned',
    notificationKind: 'return_in_progress',
  },
  {
    audience: 'merchant',
    normalizedStatus: 'cancelled',
    notificationKind: 'cancelled',
  },
  {
    audience: 'customer',
    normalizedStatus: 'cancelled',
    notificationKind: 'cancelled',
  },
] as const satisfies readonly GiglTrackingNotificationPolicy[];

export function getGiglTrackingNotificationPolicies(
  rawStatus: string,
  normalizedStatus: NormalizedShipmentStatus
): readonly GiglTrackingNotificationPolicy[] {
  const normalizedRawStatus = rawStatus.trim().toUpperCase();
  const rawMatches = GIGL_TRACKING_NOTIFICATION_POLICY_MATRIX.filter(
    (policy) =>
      'rawStatus' in policy && policy.rawStatus === normalizedRawStatus
  );

  return rawMatches.length > 0
    ? rawMatches
    : GIGL_TRACKING_NOTIFICATION_POLICY_MATRIX.filter(
        (policy) =>
          'normalizedStatus' in policy &&
          policy.normalizedStatus === normalizedStatus
      );
}
