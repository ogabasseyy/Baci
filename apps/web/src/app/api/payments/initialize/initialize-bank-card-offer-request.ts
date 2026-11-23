import type { SupabaseClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { initializeBankCardOfferCheckout } from '@/lib/checkout/initialize-bank-card-offer-checkout';
import { checkCsrfProtection } from '@/lib/csrf';

function unavailable() {
  return NextResponse.json(
    {
      error: 'Bank card offer checkout unavailable',
      code: 'BANK_CARD_OFFER_UNAVAILABLE',
    },
    { status: 409 }
  );
}

export async function initializeBankCardOfferRequest(
  request: NextRequest,
  data: {
    merchant_id: string;
    order_id: string;
    customer_email: string;
    currency: string;
    gateway?: string;
    payment_type?: string;
  },
  createClient: (merchantId: string, userId: string) => Promise<SupabaseClient>
) {
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) {
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
    );
  }
  const merchantId = data.merchant_id.toLowerCase();
  const auth = await authenticateApiRequest(request);
  if (
    !auth.user ||
    (data.gateway && data.gateway !== 'paystack') ||
    data.payment_type
  ) {
    return unavailable();
  }
  const client = await createClient(merchantId, auth.user.id);
  const result = await initializeBankCardOfferCheckout({
    client,
    merchantId,
    orderId: data.order_id,
    email: data.customer_email,
    currency: data.currency,
    request,
  });
  if (result.kind === 'unavailable') {
    return unavailable();
  }
  if (result.kind === 'retired') {
    return NextResponse.json(
      {
        code: 'CHECKOUT_ORDER_NOT_REUSABLE',
        error:
          'This bank card offer expired. Choose an available payment option and try again.',
      },
      { status: 409 }
    );
  }
  if (result.kind === 'retryable') {
    return NextResponse.json(
      {
        code: 'BANK_CARD_OFFER_INITIALIZATION_PENDING',
        reference: result.reference,
      },
      { status: 503, headers: { 'Retry-After': '5' } }
    );
  }
  if (result.kind === 'pending') {
    return NextResponse.json(
      {
        code: 'BANK_CARD_OFFER_RECONCILIATION_REQUIRED',
        reference: result.reference,
      },
      { status: 202 }
    );
  }
  return NextResponse.json({
    success: true,
    gateway: 'paystack',
    payment_method: 'bank_card_offer',
    reference: result.reference,
    authorization_url: result.checkoutUrl,
    checkout_url: result.checkoutUrl,
  });
}
