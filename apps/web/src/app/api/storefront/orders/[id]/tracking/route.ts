import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { isValidUuid } from '@/lib/sanitize-core';
import { shippingService } from '@/lib/shipping';
import { SHIPMENT_STATUS_LABELS } from '@/lib/shipping/tracking-types';
import type { ShippingProviderCode } from '@/lib/shipping/types';
import { createClient } from '@/lib/supabase/server';
import { resolveMerchantIdBySlug } from '../resolve-merchant-id-by-slug';

const HEADERS = {
  'Cache-Control': 'private, no-store',
};

const TRACKABLE_SHIPPING_STATUSES = new Set([
  'shipped',
  'out_for_delivery',
  'delivered',
]);

const KNOWN_PROVIDERS = new Set<ShippingProviderCode>(['GIGL', 'TOPSHIP']);

function normalizeProvider(
  value: string | null | undefined
): ShippingProviderCode | undefined {
  const upper = value?.trim().toUpperCase();
  if (upper && KNOWN_PROVIDERS.has(upper as ShippingProviderCode)) {
    return upper as ShippingProviderCode;
  }
  return undefined;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json(
      { error: 'Invalid order ID' },
      { status: 400, headers: HEADERS }
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401, headers: HEADERS }
    );
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(
      'id, merchant_id, order_number, shipping_status, shipping_provider, tracking_number'
    )
    .eq('id', id)
    .maybeSingle();

  if (orderError) {
    return NextResponse.json(
      { error: 'Unable to load order tracking' },
      { status: 500, headers: HEADERS }
    );
  }

  if (!order) {
    return NextResponse.json(
      { error: 'Order not found' },
      { status: 404, headers: HEADERS }
    );
  }

  const merchantSlug =
    request.nextUrl.searchParams.get('merchantSlug')?.trim() ||
    request.nextUrl.searchParams.get('merchant_slug')?.trim() ||
    '';
  if (merchantSlug) {
    const requestedMerchantId = await resolveMerchantIdBySlug(
      merchantSlug,
      supabase
    );
    if (!requestedMerchantId || requestedMerchantId !== order.merchant_id) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404, headers: HEADERS }
      );
    }
  }

  const shippingStatus = order.shipping_status?.trim().toLowerCase() ?? '';
  const trackingNumber = order.tracking_number?.trim() ?? '';

  if (!TRACKABLE_SHIPPING_STATUSES.has(shippingStatus) || !trackingNumber) {
    return NextResponse.json(
      {
        trackingAvailable: false,
        reason: 'Tracking is available once your order has been shipped.',
      },
      { status: 200, headers: HEADERS }
    );
  }

  const providerCode = normalizeProvider(order.shipping_provider);

  try {
    const result = await shippingService.trackShipment(
      trackingNumber,
      providerCode
    );
    return NextResponse.json(
      {
        trackingAvailable: true,
        tracking: {
          provider: result.provider,
          carrierName: result.carrierName,
          trackingNumber: result.trackingNumber,
          status: result.status,
          statusLabel: SHIPMENT_STATUS_LABELS[result.status] ?? result.status,
          estimatedDelivery: result.estimatedDelivery
            ? result.estimatedDelivery.toISOString()
            : null,
          actualDelivery: result.actualDelivery
            ? result.actualDelivery.toISOString()
            : null,
          events: result.events.slice(0, 10).map((event) => ({
            status: event.status,
            description: event.description,
            location: event.location ?? null,
            timestamp: event.timestamp.toISOString(),
          })),
          liveUnavailable: false,
        },
      },
      { status: 200, headers: HEADERS }
    );
  } catch {
    const fallbackLabel =
      shippingStatus === 'delivered'
        ? 'Delivered'
        : shippingStatus === 'out_for_delivery'
          ? 'Out for Delivery'
          : 'Shipped';
    return NextResponse.json(
      {
        trackingAvailable: true,
        tracking: {
          provider: providerCode ?? order.shipping_provider ?? 'Carrier',
          carrierName:
            providerCode === 'GIGL'
              ? 'GIG Logistics'
              : (order.shipping_provider ?? 'Carrier'),
          trackingNumber,
          status: shippingStatus,
          statusLabel: fallbackLabel,
          estimatedDelivery: null,
          actualDelivery: null,
          events: [],
          liveUnavailable: true,
        },
      },
      { status: 200, headers: HEADERS }
    );
  }
}
