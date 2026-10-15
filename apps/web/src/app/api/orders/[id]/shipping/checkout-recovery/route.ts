import { type NextRequest, NextResponse } from 'next/server';
import { toAdminPublicQuote } from '@/app/api/shipping/quotes/admin-order-gigl-quote.helpers';
import {
  buildAdminOrderGiglProductLookup,
  mapAdminOrderGiglQuoteItems,
} from '@/app/api/shipping/quotes/admin-order-gigl-quote-items';
import {
  authenticateApiRequest,
  getUserAccess,
  hasPermission,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { ShippingService } from '@/lib/shipping';
import { buildOrderGiglQuoteRequest } from '@/lib/shipping/build-order-gigl-quote-request';
import { selectPreferredQuote } from '@/lib/shipping/order-shipment-booking-utils';
import { prepareCheckoutShippingRecovery } from '@/lib/shipping/prepare-checkout-shipping-recovery';
import { resolveBookingMerchantSender } from '@/lib/shipping/resolve-booking-merchant-sender';
import { resolveRecoveryQuoteReceiver } from '@/lib/shipping/resolve-recovery-quote-receiver';
import type { ShippingQuote } from '@/lib/shipping/types';
import {
  shippingCheckoutRecoveryIdSchema,
  shippingCheckoutRecoverySchema,
} from '@/schemas/shipping-checkout-recovery';
import { shippingRecoveryContextSchema } from '@/schemas/shipping-checkout-recovery-context';
import { shippingCheckoutRecoveryConfirmationSchema } from '@/schemas/shipping-checkout-recovery-response';
import { recoveryFailure } from './route.failure';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.user || !auth.supabase)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!shippingCheckoutRecoveryIdSchema.safeParse(id).success)
    return NextResponse.json({ error: 'Invalid order' }, { status: 400 });
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
    );
  const parsed = shippingCheckoutRecoverySchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success)
    return NextResponse.json(
      {
        error: 'Confirm a complete destination and pin.',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  const access = await getUserAccess(auth.supabase);
  if (
    !access?.isOwner ||
    !access.merchantId ||
    !hasPermission(access, 'orders', 'fulfill') ||
    !hasPermission(access, 'orders', 'edit')
  )
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  // Nigeria scope and legacy postal normalization run after access: auth
  // failures stay 403 even for foreign destinations.
  const supabase = auth.supabase;
  if (parsed.data.action === 'confirm') {
    const { data, error } = await supabase.rpc(
      'confirm_customer_checkout_shipping_recovery' as never,
      {
        p_order_id: id,
        p_preview_id: parsed.data.previewId,
        p_confirm_destination: parsed.data.confirmDestination,
      } as never
    );
    if (error) return recoveryFailure(error);
    const confirmed =
      shippingCheckoutRecoveryConfirmationSchema.safeParse(data);
    return confirmed.success
      ? NextResponse.json(confirmed.data)
      : recoveryFailure(null);
  }
  const { data, error } = await supabase.rpc(
    'get_customer_checkout_shipping_recovery_context' as never,
    { p_order_id: id } as never
  );
  if (error) return recoveryFailure(error);
  const context = shippingRecoveryContextSchema.safeParse(data);
  if (!context.success) return recoveryFailure(null);
  // A context row for another order or merchant means the caller is probing
  // outside its access scope: fail closed with 403, not a generic error.
  if (
    context.data.order.id !== id ||
    context.data.order.merchant_id !== access.merchantId
  )
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { order, fingerprint, quote_preference: preference } = context.data;
  const resolvedReceiver =
    parsed.data.action === 'preview'
      ? resolveRecoveryQuoteReceiver(
          parsed.data.receiver,
          order.shipping_address
        )
      : null;
  if (resolvedReceiver && 'error' in resolvedReceiver)
    return NextResponse.json(
      { error: resolvedReceiver.error },
      { status: 400 }
    );
  if (
    preference?.is_station_pickup ||
    (order.delivery_method !== null && order.delivery_method !== 'door')
  )
    return NextResponse.json(
      {
        error:
          'This recovery supports GIG address delivery. Pickup-station orders need a separate review.',
      },
      { status: 409 }
    );
  const sender = await resolveBookingMerchantSender(
    supabase,
    access.merchantId
  );
  if (!sender.ok)
    return NextResponse.json(
      { error: sender.error },
      { status: sender.status }
    );
  // Quote only surviving units: after a partial refund finishes reconciliation,
  // fully refunded lines resolve to zero and are dropped so the carrier prices
  // the shipment booking will actually send.
  const shippableItems = order.order_items.flatMap((item) =>
    item.fulfillment_quantity > 0
      ? [{ ...item, quantity: item.fulfillment_quantity }]
      : []
  );
  if (!shippableItems.length)
    return NextResponse.json(
      { error: 'No shippable units remain on this order.' },
      { status: 400 }
    );
  const productLookup = buildAdminOrderGiglProductLookup(shippableItems);
  const built = await buildOrderGiglQuoteRequest(
    { ...order, order_items: mapAdminOrderGiglQuoteItems(shippableItems) },
    sender.sender,
    async () => productLookup,
    resolvedReceiver && 'override' in resolvedReceiver
      ? resolvedReceiver.override
      : { ...parsed.data.receiver }
  );
  if (!built.ok)
    return NextResponse.json(
      {
        error:
          'The order needs complete shipping details before a quote can be previewed.',
        code: built.code,
      },
      { status: built.status }
    );
  if (built.request.shipmentType !== 'domestic')
    return NextResponse.json(
      { error: 'This recovery supports domestic GIG address delivery only.' },
      { status: 409 }
    );
  let quotes: ShippingQuote[];
  try {
    quotes = await new ShippingService().getProviderQuotes(
      'GIGL',
      built.request
    );
  } catch {
    return NextResponse.json(
      { error: 'GIGL quote unavailable. Please try again.' },
      { status: 503 }
    );
  }
  const quote = selectPreferredQuote(
    quotes.filter(
      (candidate) =>
        candidate.provider === 'GIGL' &&
        candidate.currency === 'NGN' &&
        !candidate.isStationPickup &&
        (!preference?.service_tier ||
          candidate.serviceTier === preference.service_tier) &&
        (!preference?.carrier_name ||
          candidate.carrierName === preference.carrier_name)
    ),
    {
      serviceTier: preference?.service_tier ?? null,
      carrierName: preference?.carrier_name ?? null,
      providerRateId: preference?.provider_rate_id ?? null,
      // The original quote row is usually gone in recovery: without a saved
      // preference, match the paid fee so a GoFaster order is not reported
      // price-changed when its exact candidate is still offered.
      samePrice: order.shipping_fee,
    }
  );
  if (!quote)
    return NextResponse.json(
      { error: 'No matching delivery quote is available.' },
      { status: 503 }
    );
  const paidShippingFee = order.shipping_fee;
  if (quote.price !== paidShippingFee)
    return NextResponse.json({
      previewId: null,
      quote: toAdminPublicQuote(quote),
      paidShippingFee,
      canConfirm: false,
      error:
        'The fresh quote differs from the shipping fee already paid. This recovery cannot change the paid amount.',
    });
  let staged: { data: unknown; error: { message?: string } | null };
  try {
    staged = await prepareCheckoutShippingRecovery(supabase, {
      orderId: id,
      merchantId: access.merchantId,
      fingerprint,
      paidShippingFee,
      quote,
      quoteRequest: built.request,
    });
  } catch {
    return recoveryFailure({
      message: 'invalid_checkout_shipping_recovery_proof_context',
    });
  }
  if (staged.error) return recoveryFailure(staged.error);
  if (
    typeof staged.data !== 'string' ||
    !shippingCheckoutRecoveryIdSchema.safeParse(staged.data).success
  )
    return recoveryFailure(null);
  return NextResponse.json({
    previewId: staged.data,
    quote: {
      ...toAdminPublicQuote(quote),
      expiresAt: new Date(
        Math.min(quote.expiresAt.getTime(), Date.now() + 5 * 60_000)
      ).toISOString(),
    },
    paidShippingFee,
    canConfirm: true,
  });
}
