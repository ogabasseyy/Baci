import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type ExternalWaybillMatch,
  type ExternalWaybillOrderReceiver,
  matchExternalWaybillToOrder,
} from './gigl-external-waybill-match';
import { giglProvider } from './providers/gigl';
import { isGiglRuntimeConfigured } from './providers/gigl.constants';
import {
  type GiglExternalWaybillLookup,
  isGiglWaybillOwnedByAccount,
} from './providers/gigl.external-waybill';
import { SHIPMENT_STATUS_LABELS } from './tracking-types';

const LINKABLE_SHIPPING_STATUSES = new Set([
  'pending',
  'processing',
  'shipped',
]);
const RELEASED_SHIPMENT_STATUSES = '("cancelled","failed","returned")';

export class ExternalWaybillError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = 'ExternalWaybillError';
  }
}

type ExternalWaybillOrder = ExternalWaybillOrderReceiver & {
  id: string;
  order_number: string | null;
  shipping_status: string | null;
};

export type FoundExternalWaybill = Extract<
  GiglExternalWaybillLookup,
  { status: 'found' }
>;

export interface ExternalWaybillPreview {
  waybill: string;
  linkable: boolean;
  match: Omit<ExternalWaybillMatch, 'linkable'>;
  order: { customerName: string | null; orderNumber: string | null };
  /** GIG's receiver details, shown only once the receiver is this customer. */
  gig: {
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
  } | null;
}

async function loadOrder(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string
): Promise<ExternalWaybillOrder> {
  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, order_number, customer_name, customer_phone, shipping_address, shipping_status'
    )
    .eq('id', orderId)
    .eq('merchant_id', merchantId)
    .maybeSingle();
  if (error) {
    throw new ExternalWaybillError(
      'Failed to load order',
      500,
      'ORDER_LOOKUP_FAILED'
    );
  }
  if (!data) {
    throw new ExternalWaybillError('Order not found', 404, 'ORDER_NOT_FOUND');
  }
  return data as ExternalWaybillOrder;
}

async function assertMerchantCanLink(
  supabase: SupabaseClient,
  merchantId: string,
  order: ExternalWaybillOrder,
  waybill: string
): Promise<void> {
  if (!LINKABLE_SHIPPING_STATUSES.has(order.shipping_status ?? '')) {
    throw new ExternalWaybillError(
      'This order can no longer take a GIG waybill.',
      409,
      'ORDER_NOT_LINKABLE'
    );
  }

  const [settings, liveShipment, waybillShipment, waybillOrder] =
    await Promise.all([
      supabase
        .from('merchant_feature_settings')
        .select('shipping_providers')
        .eq('merchant_id', merchantId)
        .maybeSingle(),
      supabase
        .from('shipments')
        .select('id')
        .eq('order_id', order.id)
        .eq('merchant_id', merchantId)
        .not('status', 'in', RELEASED_SHIPMENT_STATUSES)
        .limit(1)
        .maybeSingle(),
      supabase
        .from('shipments')
        .select('id')
        .eq('provider', 'GIGL')
        .eq('tracking_number', waybill)
        .neq('status', 'cancelled')
        .limit(1)
        .maybeSingle(),
      supabase
        .from('orders')
        .select('id')
        .eq('merchant_id', merchantId)
        .eq('tracking_number', waybill)
        .neq('id', order.id)
        .limit(1)
        .maybeSingle(),
    ]);
  if (
    settings.error ||
    liveShipment.error ||
    waybillShipment.error ||
    waybillOrder.error
  ) {
    throw new ExternalWaybillError(
      'Failed to check this order',
      500,
      'ORDER_LOOKUP_FAILED'
    );
  }

  const providers: unknown = settings.data?.shipping_providers;
  const giglEnabled =
    Array.isArray(providers) &&
    providers.some(
      (provider) =>
        typeof provider === 'string' && provider.trim().toLowerCase() === 'gigl'
    );
  if (!giglEnabled) {
    throw new ExternalWaybillError(
      'Turn on GIG Logistics in your shipping settings first.',
      409,
      'GIGL_NOT_ENABLED'
    );
  }
  if (liveShipment.data) {
    throw new ExternalWaybillError(
      'This order already has a shipment.',
      409,
      'ORDER_SHIPMENT_EXISTS'
    );
  }
  if (waybillShipment.data || waybillOrder.data) {
    throw new ExternalWaybillError(
      'This waybill is already attached to another order.',
      409,
      'WAYBILL_ALREADY_LINKED'
    );
  }
}

async function lookupOwnedWaybill(
  waybill: string
): Promise<FoundExternalWaybill> {
  if (!isGiglRuntimeConfigured()) {
    throw new ExternalWaybillError(
      'GIG Logistics is not available right now.',
      503,
      'GIGL_UNAVAILABLE'
    );
  }
  let lookup: GiglExternalWaybillLookup;
  try {
    lookup = await giglProvider.lookupExternalWaybill(waybill);
  } catch {
    throw new ExternalWaybillError(
      'Could not reach GIG Logistics. Please try again.',
      502,
      'GIGL_LOOKUP_FAILED'
    );
  }
  if (lookup.status === 'not_found') {
    throw new ExternalWaybillError(
      'GIG Logistics has no shipment with this waybill.',
      404,
      'WAYBILL_NOT_FOUND'
    );
  }
  if (!isGiglWaybillOwnedByAccount(lookup.preShipment, lookup.account)) {
    throw new ExternalWaybillError(
      'This waybill was not booked on your GIG Logistics account.',
      403,
      'WAYBILL_NOT_IN_ACCOUNT'
    );
  }
  if (lookup.preShipment.IsCancelled || lookup.preShipment.IsDeleted) {
    throw new ExternalWaybillError(
      'This waybill was cancelled on GIG Logistics.',
      409,
      'WAYBILL_CANCELLED'
    );
  }
  return lookup;
}

function describeGigShipment(
  lookup: FoundExternalWaybill
): NonNullable<ExternalWaybillPreview['gig']> {
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

/**
 * Checks a GIG waybill booked outside Baci against an order: the order can
 * take it, GIG knows it, it belongs to Baci's GIG account, and the receiver
 * is this order's customer. Read-only.
 */
export async function previewExternalGiglWaybill({
  merchantId,
  orderId,
  supabase,
  waybill,
}: {
  merchantId: string;
  orderId: string;
  supabase: SupabaseClient;
  waybill: string;
}): Promise<{ lookup: FoundExternalWaybill; preview: ExternalWaybillPreview }> {
  const order = await loadOrder(supabase, merchantId, orderId);
  await assertMerchantCanLink(supabase, merchantId, order, waybill);
  const lookup = await lookupOwnedWaybill(waybill);
  const { linkable, ...match } = matchExternalWaybillToOrder(
    order,
    lookup.preShipment
  );
  // A shared name alone is weak evidence: reveal GIG's details only on a
  // matching phone or a full match (receiver and destination).
  const receiverConfirmed = linkable || match.phone === 'match';

  return {
    lookup,
    preview: {
      waybill,
      linkable,
      match,
      order: {
        customerName: order.customer_name,
        orderNumber: order.order_number,
      },
      gig: receiverConfirmed ? describeGigShipment(lookup) : null,
    },
  };
}
