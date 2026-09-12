/**
 * Shipping Tracking API
 * Track a shipment by tracking number
 */

import { cookies } from 'next/headers';
import { after, type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { maybeNotifyActivateProtection } from '@/lib/insurance/notify-activate-protection';
import { shippingService } from '@/lib/shipping';
import type {
  NormalizedShipmentStatus,
  ShippingProviderCode,
  TrackingResult,
} from '@/lib/shipping/types';
import { createClient } from '@/lib/supabase/server';
import { trackingParamsSchema } from '@/schemas/shipping-tracking';

// =============================================================================
// POST /api/shipping/track/[trackingNumber] - Fetch current shipment tracking
// =============================================================================

type SupabaseServerClient = ReturnType<typeof createClient>;

type ShipmentLookupResult = {
  carrier_name: string | null;
  estimated_delivery_days: number | null;
  id: string;
  order_id: string | null;
  provider: string | null;
  receiver_address?: {
    city?: string | null;
    state?: string | null;
  } | null;
};

const ORDER_STATUS_BY_SHIPMENT_STATUS: Record<
  NormalizedShipmentStatus,
  string
> = {
  pending: 'pending',
  booked: 'shipped',
  pickup_scheduled: 'shipped',
  picked_up: 'shipped',
  in_transit: 'shipped',
  out_for_delivery: 'shipped',
  delivered: 'delivered',
  cancelled: 'cancelled',
  failed: 'failed',
  returned: 'returned',
};

export function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST to refresh shipment tracking.' },
    { headers: { Allow: 'POST' }, status: 405 }
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ trackingNumber: string }> }
) {
  try {
    const parsedParams = trackingParamsSchema.safeParse(await params);

    if (!parsedParams.success) {
      return NextResponse.json(
        { error: 'Tracking number required' },
        { status: 400 }
      );
    }

    const { trackingNumber } = parsedParams.data;
    const csrf = await checkCsrfProtection(request);
    if (!csrf.valid) {
      return (
        csrf.response ??
        NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
      );
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // Try to find shipment in our database first (to get provider)
    const { data: shipment } = await supabase
      .from('shipments')
      .select(
        'id, provider, order_id, carrier_name, receiver_address, estimated_delivery_days'
      )
      .eq('tracking_number', trackingNumber)
      .single();

    let trackingResult: TrackingResult;

    if (shipment?.provider) {
      // Track with known provider
      trackingResult = await shippingService.trackShipment(
        trackingNumber,
        shipment.provider as ShippingProviderCode
      );
    } else {
      // Try all providers
      trackingResult = await shippingService.trackShipment(trackingNumber);
    }

    if (shipment) {
      await persistTrackingResult({
        shipment: shipment as ShipmentLookupResult,
        supabase,
        trackingResult,
      });
    }

    return NextResponse.json({
      trackingNumber,
      carrier: trackingResult.carrierName,
      provider: trackingResult.provider,
      status: trackingResult.status,
      statusLabel: getStatusLabel(trackingResult.status),
      estimatedDelivery: trackingResult.estimatedDelivery?.toISOString(),
      actualDelivery: trackingResult.actualDelivery?.toISOString(),
      events: trackingResult.events.map((e) => ({
        status: e.status,
        description: e.description,
        location: e.location,
        timestamp: e.timestamp.toISOString(),
      })),
      // Include additional shipment details if we have them
      shipment: shipment
        ? {
            id: shipment.id,
            orderId: shipment.order_id,
            receiverCity: shipment.receiver_address?.city,
            receiverState: shipment.receiver_address?.state,
            estimatedDays: shipment.estimated_delivery_days,
          }
        : undefined,
    });
  } catch (error) {
    console.error('Error tracking shipment:', error);

    // Return a friendly error message
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        {
          error:
            'Shipment not found. Please check the tracking number and try again.',
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to track shipment' },
      { status: 500 }
    );
  }
}

// =============================================================================
// HELPERS
// =============================================================================

async function persistTrackingResult({
  shipment,
  supabase,
  trackingResult,
}: {
  shipment: ShipmentLookupResult;
  supabase: SupabaseServerClient;
  trackingResult: TrackingResult;
}) {
  const shippingStatus =
    ORDER_STATUS_BY_SHIPMENT_STATUS[trackingResult.status] || 'processing';
  const delivered = shippingStatus === 'delivered';
  const snapshot = buildTrackingSnapshot(trackingResult);

  const { data: updatedShipment, error: shipmentUpdateError } = await supabase
    .from('shipments')
    .update(snapshot)
    .eq('id', shipment.id)
    .select('id')
    .maybeSingle();

  if (shipmentUpdateError || !updatedShipment) {
    console.error('Error updating shipment tracking snapshot:', {
      error: shipmentUpdateError ?? 'No shipment row updated',
      shipmentId: shipment.id,
    });
    // Customer tracking should return the live carrier result even when RLS
    // denies opportunistic snapshot persistence for the request-scoped client.
    // Do not fall back to a customer-callable delivered RPC here: a signed-in
    // customer can invoke granted RPCs directly, bypassing the carrier result
    // that this route just verified.
    return;
  }

  // Repair pickups are valid orderless shipments. Persist their live carrier
  // snapshot without attempting order fulfilment or insurance side effects.
  if (!shipment.order_id) {
    return;
  }

  const { error: orderUpdateError } = await supabase
    .from('orders')
    .update({ shipping_status: shippingStatus })
    .eq('id', shipment.order_id);

  if (orderUpdateError) {
    console.error('Error updating order shipping status from tracking:', {
      error: orderUpdateError,
      orderId: shipment.order_id,
    });
    // Same fail-closed rule as above: do not let a customer-scoped fallback
    // transition an order to delivered when the normal order update is denied.
    return;
  }

  if (delivered) {
    // Best-effort push — don't block the tracking read on it. `after` runs the
    // task once the response has been sent (falls back to fire-and-forget if
    // unavailable), matching api/orders/[id]/route.ts.
    const orderId = shipment.order_id;
    try {
      after(() => notifyDeliveredProtectionActivation(orderId));
    } catch {
      void notifyDeliveredProtectionActivation(orderId);
    }
  }
}

function buildTrackingSnapshot(trackingResult: TrackingResult) {
  return {
    status: trackingResult.status,
    current_location: trackingResult.events[0]?.location,
    estimated_delivery_at: trackingResult.estimatedDelivery?.toISOString(),
    delivered_at: trackingResult.actualDelivery?.toISOString(),
    tracking_events: trackingResult.events,
    last_tracked_at: new Date().toISOString(),
  };
}

async function notifyDeliveredProtectionActivation(orderId: string) {
  try {
    await maybeNotifyActivateProtection(orderId);
  } catch (err) {
    console.error('Failed to send activate-protection push:', err);
  }
}

function getStatusLabel(status: NormalizedShipmentStatus): string {
  const labels: Record<NormalizedShipmentStatus, string> = {
    pending: 'Order Received',
    booked: 'Shipment Booked',
    pickup_scheduled: 'Pickup Scheduled',
    picked_up: 'Picked Up',
    in_transit: 'In Transit',
    out_for_delivery: 'Out for Delivery',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    failed: 'Delivery Failed',
    returned: 'Returned to Sender',
  };
  return labels[status] || status;
}
