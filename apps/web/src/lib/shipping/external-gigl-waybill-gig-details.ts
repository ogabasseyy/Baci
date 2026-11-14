import type { FoundExternalWaybill } from './external-gigl-waybill-preview';
import { SHIPMENT_STATUS_LABELS } from './tracking-types';

export interface ExternalWaybillGigDetails {
  receiverName: string | null;
  receiverPhoneLast4: string | null;
  destinationState: string | null;
  deliveryType: 'home' | 'station';
  stationAddress: string | null;
  trackingStatus: string | null;
  lastUpdate: {
    description: string;
    location: string | null;
    at: string;
  } | null;
}

/** What staff see about a GIG parcel once it is confirmed to be this order's. */
export function describeExternalWaybillGigDetails(
  lookup: FoundExternalWaybill
): ExternalWaybillGigDetails {
  const { preShipment, tracking } = lookup;
  const phoneDigits = (preShipment.ReceiverPhoneNumber ?? '').replace(
    /\D/g,
    ''
  );
  const isStation = preShipment.IsHomeDelivery === false;
  const latest = [...(tracking?.events ?? [])].sort(
    (left, right) => right.timestamp.getTime() - left.timestamp.getTime()
  )[0];
  return {
    receiverName: preShipment.ReceiverName ?? null,
    receiverPhoneLast4: phoneDigits.length >= 4 ? phoneDigits.slice(-4) : null,
    destinationState: preShipment.ReceiverState ?? null,
    deliveryType: isStation ? 'station' : 'home',
    stationAddress: isStation ? (preShipment.ReceiverAddress ?? null) : null,
    trackingStatus: tracking ? SHIPMENT_STATUS_LABELS[tracking.status] : null,
    lastUpdate: latest
      ? {
          description: latest.description,
          location: latest.location ?? null,
          at: latest.timestamp.toISOString(),
        }
      : null,
  };
}
