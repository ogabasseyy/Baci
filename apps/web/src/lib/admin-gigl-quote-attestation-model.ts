export type AdminQuoteSnapshot = {
  id: string;
  orderId: string;
  merchantId: string;
  provider: string;
  currency: string;
  pricingVersion: string;
  price: number;
  providerCost: number | null;
  platformMargin: number | null;
  expiresAt: string;
  isStationPickup: boolean;
  providerRateId: string | null;
  quoteRequest: Record<string, unknown> | null;
};

export type AdminQuoteOrderState = {
  id: string;
  merchantId: string;
  shipmentId?: string | null;
  trackingNumber?: string | null;
  shippingStatus?: string | null;
};

export type AdminQuoteBindingResult =
  | {
      ok: true;
      update: {
        selectedQuoteId: string;
        shippingProvider: 'GIGL';
        shippingFundingSource: 'merchant_wallet';
      };
    }
  | { ok: false; code: string };

const PROVENANCE = 'server_gigl_v1';
const PRICING_VERSION = 'gigl_platform_margin_v1';

function alreadyTransitioned(order: AdminQuoteOrderState): boolean {
  return Boolean(
    order.shipmentId ||
      order.trackingNumber ||
      ['shipped', 'booked', 'in_transit'].includes(
        String(order.shippingStatus ?? '').toLowerCase()
      )
  );
}

function sameSnapshot(a: AdminQuoteSnapshot, b: AdminQuoteSnapshot): boolean {
  return (
    a.id === b.id &&
    a.orderId === b.orderId &&
    a.merchantId === b.merchantId &&
    a.provider === b.provider &&
    a.currency === b.currency &&
    a.pricingVersion === b.pricingVersion &&
    a.price === b.price &&
    a.providerCost === b.providerCost &&
    a.platformMargin === b.platformMargin &&
    a.expiresAt === b.expiresAt &&
    a.isStationPickup === b.isStationPickup &&
    a.providerRateId === b.providerRateId &&
    JSON.stringify(a.quoteRequest) === JSON.stringify(b.quoteRequest)
  );
}

/**
 * Deterministic contract model for the SQL binder. The database RPC remains
 * authoritative; this model makes its trust boundary executable in unit
 * tests without requiring a live Supabase database.
 */
export function evaluateAdminGiglQuoteBinding(input: {
  now: string;
  authUserId: string | null;
  merchantOwnerUserId: string;
  order: AdminQuoteOrderState;
  quote: AdminQuoteSnapshot | null;
  attestation: AdminQuoteSnapshot | null;
}): AdminQuoteBindingResult {
  if (!input.authUserId || input.authUserId !== input.merchantOwnerUserId)
    return { ok: false, code: 'forbidden' };
  if (
    input.order.id !== input.quote?.orderId ||
    input.order.merchantId !== input.quote?.merchantId
  )
    return { ok: false, code: 'order_not_found' };
  if (alreadyTransitioned(input.order))
    return { ok: false, code: 'order_already_shipped_or_booked' };
  if (!input.quote || !input.attestation)
    return { ok: false, code: 'invalid_quote_attestation' };
  if (!sameSnapshot(input.quote, input.attestation))
    return { ok: false, code: 'invalid_quote_attestation' };
  if (
    input.quote.provider !== 'GIGL' ||
    input.quote.currency !== 'NGN' ||
    input.quote.pricingVersion !== PRICING_VERSION ||
    input.quote.isStationPickup ||
    input.quote.price <= 0 ||
    new Date(input.quote.expiresAt).getTime() <=
      new Date(input.now).getTime() ||
    input.quote.quoteRequest?.admin_order_provenance !== PROVENANCE
  )
    return { ok: false, code: 'invalid_quote_attestation' };
  return {
    ok: true,
    update: {
      selectedQuoteId: input.quote.id,
      shippingProvider: 'GIGL',
      shippingFundingSource: 'merchant_wallet',
    },
  };
}
