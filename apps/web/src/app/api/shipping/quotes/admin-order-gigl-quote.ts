import { type NextRequest, NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getUserAccess,
  hasPermission,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { ShippingService } from '@/lib/shipping';
import { buildOrderGiglQuoteRequest } from '@/lib/shipping/build-order-gigl-quote-request';
import { persistAdminGiglQuote } from '@/lib/shipping/persist-admin-gigl-quote';
import { resolveBookingMerchantSender } from '@/lib/shipping/resolve-booking-merchant-sender';
import type { ShippingQuote } from '@/lib/shipping/types';
import {
  calculateAdminWalletFunding,
  selectEligibleAdminGiglQuote,
  toAdminPublicQuote,
} from './admin-order-gigl-quote.helpers';
import { resolveAdminOrderGiglQuoteInput } from './admin-order-gigl-quote-input';
import {
  buildAdminOrderGiglProductLookup,
  mapAdminOrderGiglQuoteItems,
} from './admin-order-gigl-quote-items';
import {
  ADMIN_ORDER_GIGL_QUOTE_ORDER_SELECT,
  getAdminOrderGiglQuoteOrderConflict,
} from './admin-order-gigl-quote-order';
import {
  loadBoundAdminWalletGiglQuoteResponse,
  shouldReuseBoundAdminWalletGiglQuote,
} from './load-bound-admin-wallet-gigl-quote';
import { resolveAdminGiglEligibility } from './resolve-admin-gigl-eligibility';
import { toShippingQuoteUpsert } from './shipping-quote-persistence';

export {
  calculateAdminWalletFunding,
  selectEligibleAdminGiglQuote,
} from './admin-order-gigl-quote.helpers';

export async function postAdminOrderGiglQuote(
  request: NextRequest,
  input?: Parameters<typeof resolveAdminOrderGiglQuoteInput>[1]
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.user || !auth.supabase)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
    );

  const resolvedInput = await resolveAdminOrderGiglQuoteInput(request, input);
  if ('error' in resolvedInput) {
    return NextResponse.json(resolvedInput.error, { status: 400 });
  }
  const adminOrderId = resolvedInput.admin_order_id;
  const isPreview = resolvedInput.preview === true;

  const access = await getUserAccess(auth.supabase);
  if (
    !access?.isOwner ||
    !access.merchantId ||
    !hasPermission(access, 'orders', 'fulfill')
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const eligibility = await resolveAdminGiglEligibility(
    auth.supabase,
    access.merchantId
  );
  if (!eligibility.ok) {
    return NextResponse.json(eligibility.body, { status: eligibility.status });
  }

  const { data: order, error: orderError } = await auth.supabase
    .from('orders')
    .select(ADMIN_ORDER_GIGL_QUOTE_ORDER_SELECT)
    .eq('id', adminOrderId)
    .eq('merchant_id', access.merchantId)
    .maybeSingle();
  if (orderError)
    return NextResponse.json(
      { error: 'Failed to load order' },
      { status: 500 }
    );
  if (!order)
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  const orderConflict = getAdminOrderGiglQuoteOrderConflict(order);
  if (orderConflict) return orderConflict;

  const boundQuoteId = shouldReuseBoundAdminWalletGiglQuote(order, isPreview);
  if (boundQuoteId) {
    const reused = await loadBoundAdminWalletGiglQuoteResponse(
      auth.supabase,
      access.merchantId,
      boundQuoteId,
      {
        shipping_address: order.shipping_address,
        order_items: order.order_items ?? [],
      }
    );
    if (reused) return reused;
  }

  const senderResult = await resolveBookingMerchantSender(
    auth.supabase,
    access.merchantId
  );
  if (!senderResult.ok)
    return NextResponse.json(
      { error: senderResult.error },
      { status: senderResult.status }
    );
  const rawItems = mapAdminOrderGiglQuoteItems(order.order_items ?? []);
  const productLookup = buildAdminOrderGiglProductLookup(
    order.order_items ?? []
  );
  const built = await buildOrderGiglQuoteRequest(
    { ...order, order_items: rawItems },
    senderResult.sender,
    async () => productLookup,
    resolvedInput.receiver
  );
  if (!built.ok) {
    return NextResponse.json(
      {
        error: built.code,
        code: built.code,
        ...(built.missing ? { missing: built.missing } : {}),
      },
      { status: built.status }
    );
  }

  let quotes: ShippingQuote[];
  try {
    quotes = await new ShippingService().getProviderQuotes(
      'GIGL',
      built.request
    );
  } catch {
    return NextResponse.json(
      { error: 'GIGL quote unavailable' },
      { status: 503 }
    );
  }
  const quote = selectEligibleAdminGiglQuote(quotes);
  if (!quote)
    return NextResponse.json(
      { error: 'No eligible GIGL address-delivery quote' },
      { status: 503 }
    );
  if (isPreview) {
    const { data: wallet, error: walletError } = await auth.supabase.rpc(
      'get_wallet_summary',
      { p_merchant_id: access.merchantId }
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
    const { availableBalance, shortfall, canBook } =
      calculateAdminWalletFunding(
        quote.price,
        Number(walletRow?.available_balance ?? 0)
      );
    return NextResponse.json({
      quote: toAdminPublicQuote(quote),
      availableBalance,
      shortfall,
      canBook,
    });
  }
  const quoteRequest = {
    ...built.request,
    admin_order_provenance: 'server_gigl_v1' as const,
  };
  const persisted = toShippingQuoteUpsert(quote, {
    merchantId: access.merchantId,
    sessionId: adminOrderId,
    quoteRequest,
  });
  const { error: persistError } = await persistAdminGiglQuote({
    supabase: auth.supabase,
    quote: persisted,
    attestation: {
      quote_id: quote.id,
      order_id: adminOrderId,
      merchant_id: access.merchantId,
      provider_rate_id: quote.providerRateId ?? null,
      quote_request: quoteRequest,
    },
  });
  if (persistError) {
    console.error('Error persisting Admin GIGL quote', {
      message: persistError.message,
    });
    return NextResponse.json(
      { error: 'Failed to persist quote' },
      { status: 500 }
    );
  }

  const { data: binding, error: bindError } = await auth.supabase.rpc(
    'bind_admin_gigl_quote' as never,
    {
      p_order_id: adminOrderId,
      p_merchant_id: access.merchantId,
      p_quote_id: quote.id,
      p_receiver: built.request.receiver,
    } as never
  );
  if (bindError) {
    const already = bindError.message?.includes('already');
    const staleInputs = bindError.message?.includes('stale_order_quote_inputs');
    return NextResponse.json(
      {
        code: staleInputs ? 'stale_order_quote_inputs' : undefined,
        error: staleInputs
          ? 'Order address or items changed since this quote was created. Get a new quote.'
          : already
            ? 'Order already shipped or booked'
            : 'Failed to bind quote',
      },
      { status: already || staleInputs ? 409 : 500 }
    );
  }
  const result = (Array.isArray(binding) ? binding[0] : binding) as {
    available_balance?: number;
  } | null;
  const { availableBalance, shortfall, canBook } = calculateAdminWalletFunding(
    quote.price,
    Number(result?.available_balance ?? 0)
  );
  return NextResponse.json({
    quote: toAdminPublicQuote(quote),
    availableBalance,
    shortfall,
    canBook,
  });
}
