import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { toAdminPublicQuote } from '@/app/api/shipping/quotes/admin-order-gigl-quote.helpers';
import {
  buildAdminOrderGiglProductLookup,
  mapAdminOrderGiglQuoteItems,
} from '@/app/api/shipping/quotes/admin-order-gigl-quote-items';
import { toShippingQuoteUpsert } from '@/app/api/shipping/quotes/shipping-quote-persistence';
import {
  authenticateApiRequest,
  getUserAccess,
  hasPermission,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { ShippingService } from '@/lib/shipping';
import { buildOrderGiglQuoteRequest } from '@/lib/shipping/build-order-gigl-quote-request';
import { checkoutRecoveryStreetAddress } from '@/lib/shipping/checkout-recovery-street-address';
import { selectPreferredQuote } from '@/lib/shipping/order-shipment-booking-utils';
import { resolveBookingMerchantSender } from '@/lib/shipping/resolve-booking-merchant-sender';
import { createShippingQuoteRouteProof } from '@/lib/shipping/shipping-quote-route-proof';
import type { ShippingQuote } from '@/lib/shipping/types';
import {
  shippingCheckoutRecoverySchema,
  shippingRecoveryContextSchema,
} from '@/schemas/shipping-checkout-recovery';

function failure(error: { message?: string; code?: string } | null) {
  const message = error?.message ?? '';
  if (message.includes('forbidden'))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (message.includes('price_changed'))
    return NextResponse.json(
      {
        error:
          'The fresh quote differs from the shipping fee already paid. This recovery cannot change the paid amount.',
        code: 'SHIPPING_RECOVERY_PRICE_CHANGED',
      },
      { status: 409 }
    );
  if (message.includes('funding_not_ready'))
    return NextResponse.json(
      {
        error:
          'Prepaid shipping funding is not yet available for this order. Verify payment settlement before recovering its quote.',
        code: 'SHIPPING_RECOVERY_FUNDING_NOT_READY',
      },
      { status: 409 }
    );
  if (
    message.includes('expired') ||
    message.includes('stale') ||
    error?.code === '40001' ||
    error?.code === '40P01'
  )
    return NextResponse.json(
      {
        error:
          'This preview expired or the order changed. Review the destination and preview again.',
        code: 'SHIPPING_RECOVERY_STALE',
      },
      { status: 409 }
    );
  if (
    message.includes('unavailable') ||
    message.includes('order_refunded') ||
    message.includes('order_cancelled')
  )
    return NextResponse.json(
      {
        error:
          'This order is no longer eligible for prepaid shipping recovery.',
        code: 'SHIPPING_RECOVERY_UNAVAILABLE',
      },
      { status: 409 }
    );
  console.error('Checkout shipping recovery failed', { code: error?.code });
  return NextResponse.json(
    { error: 'Unable to recover this shipping quote. Please try again.' },
    { status: 500 }
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return NextResponse.json({ error: 'Invalid order' }, { status: 400 });
  const auth = await authenticateApiRequest(request);
  if (!auth.user || !auth.supabase)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
    );
  const access = await getUserAccess(auth.supabase);
  if (
    !access?.isOwner ||
    !access.merchantId ||
    !hasPermission(access, 'orders', 'fulfill') ||
    !hasPermission(access, 'orders', 'edit')
  )
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
    if (error) return failure(error);
    const confirmed = z
      .object({ quoteId: z.uuid(), confirmed: z.literal(true) })
      .safeParse(data);
    return confirmed.success
      ? NextResponse.json(confirmed.data)
      : failure(null);
  }
  const { data, error } = await supabase.rpc(
    'get_customer_checkout_shipping_recovery_context' as never,
    { p_order_id: id } as never
  );
  if (error) return failure(error);
  const context = shippingRecoveryContextSchema.safeParse(data);
  if (
    !context.success ||
    context.data.order.id !== id ||
    context.data.order.merchant_id !== access.merchantId
  )
    return failure(null);
  const { order, fingerprint, quote_preference: preference } = context.data;
  if (preference?.is_station_pickup)
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
  const productLookup = buildAdminOrderGiglProductLookup(order.order_items);
  const built = await buildOrderGiglQuoteRequest(
    { ...order, order_items: mapAdminOrderGiglQuoteItems(order.order_items) },
    sender.sender,
    async () => productLookup,
    {
      ...parsed.data.receiver,
      address: checkoutRecoveryStreetAddress(
        parsed.data.receiver.address,
        parsed.data.receiver.city,
        parsed.data.receiver.state
      ),
    }
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
  const persisted = toShippingQuoteUpsert(quote, {
    merchantId: access.merchantId,
    sessionId: id,
    quoteRequest: built.request,
  });
  const proof = createShippingQuoteRouteProof({
    action: 'prepare_customer_checkout_shipping_recovery',
    merchantId: access.merchantId,
    subjectId: id,
    payload: { order_id: id, fingerprint, quote: persisted },
  });
  const staged = await supabase.rpc(
    'prepare_customer_checkout_shipping_recovery' as never,
    {
      p_order_id: id,
      p_fingerprint: fingerprint,
      p_quote: persisted,
      p_route_proof: proof,
    } as never
  );
  if (staged.error) return failure(staged.error);
  if (
    typeof staged.data !== 'string' ||
    !z.uuid().safeParse(staged.data).success
  )
    return failure(null);
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
