import { type NextRequest, NextResponse } from 'next/server';
import { createStorefrontOrderRpcClient } from '@/lib/checkout/storefront-order-rpc-client';
import { checkCsrfProtection } from '@/lib/csrf';
import { finalizeOrderGatewayPayment } from '@/lib/payments/finalize-order-gateway-payment';
import { getAuthenticatedUser } from '@/lib/supabase/mobile-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { verifyPaymentBodySchema } from '@/schemas/payments';
import { finalizeVerificationResponse } from './finalize-verification-response';
import { getGuestPaymentReferenceSnapshot } from './guest-payment-reference-snapshot';
import { loadPaymentVerificationTransaction } from './load-payment-verification-transaction';
import type { PaymentVerificationDependencies } from './payment-verification-dependencies';
import { getSessionlessPaymentReferenceSnapshot } from './sessionless-payment-reference-snapshot';
import { verifyBankCardOfferRequest } from './verify-bank-card-offer-request';
import {
  verifyGuestPaymentReference,
  verifyGuestPaymentReferenceByQuery,
} from './verify-guest-payment-reference';
import { verifyPaymentReference } from './verify-payment-reference';
import { verifySessionlessBankCardOffer } from './verify-sessionless-bank-card-offer';

const verification: PaymentVerificationDependencies = {
  load: (reference) =>
    loadPaymentVerificationTransaction(reference, createServiceClient),
  finalize: (input) =>
    finalizeVerificationResponse(input, finalizeOrderGatewayPayment),
};

// Read-only guest verification: CSRF validation covers non-GET requests
// only, so sessionless callers prove their order here with the
// creation tracking token (narrow snapshot RPC, no service client)
// instead of POSTing through a CSRF failure.
export function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  if (searchParams.get('reference')?.trim().startsWith('BCO-')) {
    return NextResponse.json(
      { error: 'Bank card offer verification requires authenticated POST' },
      { status: 405, headers: { Allow: 'POST' } }
    );
  }
  return verifyGuestPaymentReferenceByQuery(searchParams);
}

export async function POST(request: NextRequest) {
  const csrf = await checkCsrfProtection(request);

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return NextResponse.json(
      { error: 'Expected application/json request body' },
      { status: 415 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsedBody = verifyPaymentBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid reference' }, { status: 400 });
  }

  if (!csrf.valid) {
    // Sessionless callers verify through the read-only GET entry with
    // their creation tracking token; POST never serves a CSRF failure.
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
    );
  }

  // checkCsrfProtection accepts any syntactic `Authorization: Bearer [REDACTED]`
  // (mobile callers hold no CSRF token), so a Bearer-carrying request is
  // sessionless whatever string it bears. The sessionless lane is
  // proof-bound READ-ONLY on the caller's own client and never constructs
  // a service client: a presented tracking token uses the guest snapshot
  // (no session needed), while a bare Bearer [REDACTED] must validate to a user
  // session and then uses the ownership-checked sessionless snapshot
  // (reference to order to customer.user_id = auth.uid()). Finalization
  // stays on the webhook/service boundary; settlement polling converges
  // on the next pass. Session (cookie-CSRF) requests carry no such header
  // and keep their existing authority. Bank offers require buyer ownership
  // and record terminal reviews without settling through the bearer lane.
  const { reference, merchantSlug, trackingToken } = parsedBody.data;
  if (reference.startsWith('BCO-')) {
    return verifyBankCardOfferRequest(
      request,
      reference,
      merchantSlug,
      verification,
      (snapshot, client) =>
        verifySessionlessBankCardOffer(
          snapshot,
          client,
          createStorefrontOrderRpcClient
        )
    );
  }
  const authorizationHeader = request.headers.get('authorization');
  if (authorizationHeader && /^bearer\s+.+$/i.test(authorizationHeader)) {
    if (trackingToken) {
      const guestSnapshot = await getGuestPaymentReferenceSnapshot(
        reference,
        trackingToken
      );
      if (!guestSnapshot) {
        return NextResponse.json(
          { error: 'Verification unavailable' },
          { status: 403 }
        );
      }
      return verifyGuestPaymentReference(guestSnapshot, {
        trackingToken,
      });
    }
    const authed = await getAuthenticatedUser(request);
    const bearerClient =
      authed?.authMode === 'bearer' ? authed.supabase : undefined;
    if (!bearerClient) {
      return NextResponse.json(
        { error: 'Verification unavailable' },
        { status: 403 }
      );
    }
    const sessionlessSnapshot = await getSessionlessPaymentReferenceSnapshot(
      bearerClient,
      parsedBody.data.reference
    );
    if (!sessionlessSnapshot) {
      return NextResponse.json(
        { error: 'Verification unavailable' },
        { status: 403 }
      );
    }
    return verifyGuestPaymentReference(sessionlessSnapshot, {
      sessionlessClient: bearerClient,
    });
  }

  return verifyPaymentReference(reference, verification);
}
