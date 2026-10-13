import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { assertQuoteItemsMatchOrder } from '@/lib/shipping/international-quote-items-match';
import {
  assertQuoteReceiverMatchesOrder,
  type InternationalQuoteOrder,
} from '@/lib/shipping/international-quote-order-guard';
import {
  parseStoredQuoteRequest,
  toQuoteComparableOrderItems,
} from '@/lib/shipping/order-shipment-booking-utils';
import type { ShippingQuote } from '@/lib/shipping/types';
import {
  calculateAdminWalletFunding,
  toAdminPublicQuote,
} from './admin-order-gigl-quote.helpers';

type BoundWalletOrder = {
  selected_quote_id?: string | null;
  shipping_funding_source?: string | null;
  shipping_provider?: string | null;
};

export type BoundWalletOrderContext = {
  shipping_address: InternationalQuoteOrder['shipping_address'];
  // Raw order_items may include nested product weight/dimensions that
  // toQuoteComparableOrderItems flattens before item matching.
  order_items: unknown;
};

const ACTIVE_BOUND_QUOTE_CHARGE_STATUSES = new Set([
  'reserved',
  'provider_submitting',
  // Booked charges still need the bound quote so recoverBookedWalletShipment
  // can finish after a failed final order update without a second debit.
  'booked',
]);

export function shouldReuseBoundAdminWalletGiglQuote(
  order: BoundWalletOrder,
  isPreview: boolean
): string | null {
  if (isPreview) return null;
  if (order.shipping_funding_source !== 'merchant_wallet') return null;
  if (
    String(order.shipping_provider ?? '')
      .trim()
      .toUpperCase() !== 'GIGL'
  ) {
    return null;
  }
  return typeof order.selected_quote_id === 'string'
    ? order.selected_quote_id
    : null;
}

function boundQuoteMatchesOrderContext(
  quoteRequestRaw: unknown,
  order: BoundWalletOrderContext
): boolean {
  const quoteRequest = parseStoredQuoteRequest(quoteRequestRaw);
  if (!quoteRequest || !order.shipping_address?.address) return false;
  try {
    // Prefer the receiver assert so coordinate-only domestic addresses
    // (address + lat/lng, empty city/state) still reuse a reserved quote.
    assertQuoteReceiverMatchesOrder(quoteRequest, {
      shipping_address: order.shipping_address,
    });
    assertQuoteItemsMatchOrder(
      quoteRequest,
      toQuoteComparableOrderItems(order.order_items ?? [], { defaultWeight: 1 })
    );
    return true;
  } catch {
    return false;
  }
}

export async function loadBoundAdminWalletGiglQuoteResponse(
  supabase: SupabaseClient,
  merchantId: string,
  quoteId: string,
  order?: BoundWalletOrderContext
): Promise<NextResponse | null> {
  const { data: boundQuote, error: boundQuoteError } = await supabase
    .from('shipping_quotes')
    .select(
      'id, provider, service_tier, carrier_name, price, currency, estimated_days, expires_at, provider_rate_id, is_station_pickup, quote_request'
    )
    .eq('id', quoteId)
    .eq('merchant_id', merchantId)
    .maybeSingle();
  if (boundQuoteError) {
    return NextResponse.json(
      { error: 'Failed to load bound quote' },
      { status: 500 }
    );
  }
  if (
    !boundQuote ||
    String(boundQuote.provider).toUpperCase() !== 'GIGL' ||
    Number(boundQuote.price) <= 0
  ) {
    return null;
  }
  if (
    order &&
    !boundQuoteMatchesOrderContext(boundQuote.quote_request, order)
  ) {
    return null;
  }

  const { data: latestCharge, error: chargeError } = await supabase
    .from('merchant_shipping_charges')
    .select('status')
    .eq('merchant_id', merchantId)
    .eq('shipping_quote_id', quoteId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (chargeError) {
    return NextResponse.json(
      { error: 'Failed to load bound quote charge' },
      { status: 500 }
    );
  }
  // A refunded charge keeps the order bound to the old quote, but booking that
  // quote again returns MERCHANT_WALLET_CHARGE_REFUNDED. Force a new quote.
  if (latestCharge?.status === 'refunded') {
    return null;
  }

  const expiresAt = Date.parse(String(boundQuote.expires_at ?? ''));
  const isExpired = Number.isFinite(expiresAt) && expiresAt <= Date.now();
  const hasActiveCharge =
    typeof latestCharge?.status === 'string' &&
    ACTIVE_BOUND_QUOTE_CHARGE_STATUSES.has(latestCharge.status);
  // Expired quotes without an in-flight charge cannot be booked again.
  if (isExpired && !hasActiveCharge) {
    return null;
  }

  const { data: wallet, error: walletError } = await supabase.rpc(
    'get_wallet_summary',
    { p_merchant_id: merchantId }
  );
  if (walletError) {
    return NextResponse.json(
      { error: 'Unable to load wallet' },
      { status: 500 }
    );
  }
  const walletRow = (Array.isArray(wallet) ? wallet[0] : wallet) as {
    available_balance?: number | string | null;
  } | null;
  const shippingQuote: ShippingQuote = {
    id: boundQuote.id,
    provider: 'GIGL',
    serviceTier: String(boundQuote.service_tier ?? ''),
    carrierName: String(boundQuote.carrier_name ?? ''),
    displayName: String(boundQuote.carrier_name ?? 'GIG Logistics'),
    price: Number(boundQuote.price),
    currency: 'NGN',
    estimatedDays: Number(boundQuote.estimated_days ?? 0),
    expiresAt: new Date(String(boundQuote.expires_at)),
    pickupIncluded: true,
    insuranceIncluded: true,
    providerRateId:
      typeof boundQuote.provider_rate_id === 'string'
        ? boundQuote.provider_rate_id
        : undefined,
    isStationPickup: Boolean(boundQuote.is_station_pickup),
  };
  const funding = calculateAdminWalletFunding(
    shippingQuote.price,
    Number(walletRow?.available_balance ?? 0)
  );
  // An active reserved/provider_submitting charge already holds funds for this
  // quote — resume booking without requiring available balance again.
  const canBook = hasActiveCharge || funding.canBook;
  // Expired quotes with an in-flight/booked charge must not bounce the mobile
  // confirmation gate into a refresh loop — recovery books the same quote.
  const boundChargeRecovery = hasActiveCharge && isExpired;
  return NextResponse.json({
    quote: toAdminPublicQuote(shippingQuote),
    availableBalance: funding.availableBalance,
    shortfall: hasActiveCharge ? 0 : funding.shortfall,
    canBook,
    ...(boundChargeRecovery ? { boundChargeRecovery: true } : {}),
  });
}
