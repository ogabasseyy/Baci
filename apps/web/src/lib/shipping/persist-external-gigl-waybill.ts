import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ExternalWaybillError,
  type ExternalWaybillOrderSnapshot,
  type FoundExternalWaybill,
} from './external-gigl-waybill-preview';
import { createShippingQuoteRouteProof } from './shipping-quote-route-proof';

export const LINK_EXTERNAL_GIGL_WAYBILL_ACTION = 'link_external_gigl_waybill';

const RPC_ERRORS: Record<string, [number, string, string]> = {
  order_not_owned: [404, 'ORDER_NOT_FOUND', 'Order not found'],
  gigl_not_enabled: [
    409,
    'GIGL_NOT_ENABLED',
    'Turn on GIG Logistics in your shipping settings first.',
  ],
  order_not_linkable: [
    409,
    'ORDER_NOT_LINKABLE',
    'This order can no longer take a GIG waybill.',
  ],
  checkout_shipping_retained: [
    409,
    'CHECKOUT_SHIPPING_RETAINED',
    'The customer paid Baci for GIG delivery on this order. Book it with the GIG option instead.',
  ],
  active_shipment_booking_lock: [
    409,
    'SHIPMENT_BOOKING_IN_PROGRESS',
    'A Baci GIG booking is in progress for this order. Wait for it to finish.',
  ],
  active_merchant_shipping_charge: [
    409,
    'ACTIVE_MERCHANT_SHIPPING_CHARGE',
    'This order has a Baci GIG booking payment. Finish or cancel that booking first.',
  ],
  order_shipment_exists: [
    409,
    'ORDER_SHIPMENT_EXISTS',
    'This order already has a shipment.',
  ],
  order_changed_during_link: [
    409,
    'ORDER_CHANGED',
    'This order changed while GIG was being checked. Check the waybill again.',
  ],
  waybill_already_linked: [
    409,
    'WAYBILL_ALREADY_LINKED',
    'This waybill is already attached to another order.',
  ],
};

function trimmed(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/** The exact GIG facts the database accepts, signed by this server. */
export function buildExternalWaybillLinkPayload(
  waybill: string,
  lookup: FoundExternalWaybill,
  orderSnapshot: ExternalWaybillOrderSnapshot
) {
  const { preShipment, tracking } = lookup;
  const isStationPickup = preShipment.IsHomeDelivery === false;
  return {
    waybill,
    account_verified: true,
    receiver_match: true,
    order_receiver: orderSnapshot,
    receiver_address: {
      name: trimmed(preShipment.ReceiverName),
      phone: trimmed(preShipment.ReceiverPhoneNumber),
      address: trimmed(preShipment.ReceiverAddress),
      state: trimmed(preShipment.ReceiverState),
      country: trimmed(preShipment.ReceiverCountry),
    },
    sender_address: {
      name: trimmed(preShipment.SenderName),
      phone: trimmed(preShipment.SenderPhoneNumber),
      address: trimmed(preShipment.SenderAddress),
    },
    is_station_pickup: isStationPickup,
    station_address: isStationPickup
      ? trimmed(preShipment.ReceiverAddress)
      : null,
    price:
      typeof preShipment.GrandTotal === 'number' && preShipment.GrandTotal >= 0
        ? preShipment.GrandTotal
        : null,
    provider_snapshot: {
      source: 'gigl_external_waybill',
      customer_code: trimmed(preShipment.CustomerCode),
      receiver_station_id: preShipment.ReceiverStationId ?? null,
      destination_service_centre_id:
        preShipment.DestinationServiceCenterId ?? null,
      gig_created_at: trimmed(preShipment.DateCreated),
      tracking_status_at_link: tracking?.status ?? null,
    },
  };
}

/**
 * Creates the external GIGL shipment through the proof-gated RPC with the
 * caller's own client: ownership and orders:fulfill/edit stay DB-enforced,
 * and no wallet charge or quote is involved.
 */
export async function persistExternalGiglWaybill({
  lookup,
  merchantId,
  orderId,
  orderSnapshot,
  supabase,
  waybill,
}: {
  lookup: FoundExternalWaybill;
  orderSnapshot: ExternalWaybillOrderSnapshot;
  merchantId: string;
  orderId: string;
  supabase: SupabaseClient;
  waybill: string;
}): Promise<{ shipmentId: string }> {
  const routeProof = createShippingQuoteRouteProof({
    action: LINK_EXTERNAL_GIGL_WAYBILL_ACTION,
    merchantId,
    subjectId: orderId,
    payload: buildExternalWaybillLinkPayload(waybill, lookup, orderSnapshot),
  });
  const { data, error } = (await supabase.rpc(
    'link_external_gigl_waybill' as never,
    { p_order_id: orderId, p_route_proof: routeProof } as never
  )) as unknown as {
    data: string | null;
    error: { message?: string } | null;
  };

  if (error) {
    const mapped = RPC_ERRORS[error.message ?? ''];
    if (mapped) {
      const [status, code, message] = mapped;
      throw new ExternalWaybillError(message, status, code);
    }
    console.error('Failed to link external GIG waybill', {
      code: 'gigl_external_waybill_link_failed',
      orderId,
    });
    throw new ExternalWaybillError(
      'Could not attach this waybill. Please try again.',
      500,
      'WAYBILL_LINK_FAILED'
    );
  }
  if (typeof data !== 'string' || !data) {
    throw new ExternalWaybillError(
      'Could not attach this waybill. Please try again.',
      500,
      'WAYBILL_LINK_FAILED'
    );
  }
  return { shipmentId: data };
}
