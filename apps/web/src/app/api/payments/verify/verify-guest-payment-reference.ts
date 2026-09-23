import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import type { GatewayVerificationResult } from '@/lib/payments/types';
import { referenceSchema } from '@/schemas/payments';
import {
  type GuestPaymentReferenceSnapshot,
  getGuestPaymentReferenceSnapshot,
} from './guest-payment-reference-snapshot';

/**
 * Loads the guest snapshot over the anon client through the narrow
 * snapshot RPC. Returns null on mismatch, on malformed rows, and on
 * lookup errors (fail closed with no existence oracle). Never touches a
 * service-role table client.
 */
const guestVerificationQuerySchema = z.object({
  reference: referenceSchema,
  trackingToken: z.string().trim().min(1).max(256),
});

/**
 * Read-only GET entry for the guest tracking-token proof: CSRF validation
 * covers non-GET requests only, so sessionless callers verify here
 * instead of POSTing through a CSRF failure. Fails closed with a
 * uniform 403 (no existence oracle) when the proof is missing or the
 * snapshot RPC returns no row.
 */
export async function verifyGuestPaymentReferenceByQuery(
  searchParams: URLSearchParams
) {
  const parsed = guestVerificationQuerySchema.safeParse({
    reference: searchParams.get('reference'),
    trackingToken: searchParams.get('trackingToken'),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid reference or tracking token' },
      { status: 400 }
    );
  }
  const snapshot = await getGuestPaymentReferenceSnapshot(
    parsed.data.reference,
    parsed.data.trackingToken
  );
  if (!snapshot) {
    return NextResponse.json(
      { error: 'Verification unavailable' },
      { status: 403 }
    );
  }
  return verifyGuestPaymentReference(snapshot);
}

import {
  getVerifiedAmount,
  verifyGatewayPayment,
} from './verify-gateway-payment';

function guestOrderNumber(snapshot: GuestPaymentReferenceSnapshot): string {
  return (
    snapshot.orderNumber || snapshot.gatewayReference.slice(0, 8).toUpperCase()
  );
}

/**
 * Read-only guest verification: mirrors the session path's provider
 * checks and locally-finalized short-circuits, but performs no
 * transaction/order reads or payment-finalization writes outside the
 * proof-bound snapshot. A gateway-confirmed payment that is not yet
 * finalized reports pending — the gateway webhook owns finalization,
 * and settlement polling converges on the next pass. Never constructs
 * a service-role client.
 */
export async function verifyGuestPaymentReference(
  snapshot: GuestPaymentReferenceSnapshot
) {
  const derivedOrderNumber = guestOrderNumber(snapshot);

  // Completed transaction on a paid order with the inventory proof
  // (reads only): the paid row plus durably-held units is the completed
  // finalization — settlement polling converges here instead of waiting
  // on another pass. Invoice repair and outbox side effects stay with
  // the finalizer-owned paths (webhook / cron / session verify).
  if (
    snapshot.transactionStatus === 'completed' &&
    snapshot.orderPaymentStatus === 'paid' &&
    snapshot.inventoryConfirmed
  ) {
    const paidTotal = snapshot.orderTotal;
    const paidCurrency =
      typeof snapshot.currency === 'string'
        ? snapshot.currency.trim().toUpperCase()
        : '';
    return NextResponse.json({
      orderId: snapshot.orderId,
      paymentMethod: snapshot.gateway,
      success: true,
      status: 'success',
      orderNumber: derivedOrderNumber,
      ...(paidTotal !== null ? { orderTotal: paidTotal } : {}),
      ...(paidCurrency ? { currency: paidCurrency } : {}),
      // Locally-finalized paid order: semantically a completed finalization.
      finalizationOutcome: 'completed',
    });
  }

  if (
    snapshot.transactionStatus === 'completed' &&
    snapshot.orderPaymentStatus === 'paid'
  ) {
    // Paid row before the inventory proof: the provider already
    // confirmed (that is how the row got paid), so skip another provider
    // round-trip and report pending with the proof-bound identity —
    // settlement polling converges once the finalizer's confirm step
    // lands. Never success: unconfirmed units may still expire or be
    // missing.
    return NextResponse.json({
      success: false,
      status: 'pending',
      orderId: snapshot.orderId,
      orderNumber: derivedOrderNumber,
    });
  }

  const verification: GatewayVerificationResult = await verifyGatewayPayment(
    snapshot.gateway,
    snapshot.gatewayReference
  );

  if (!verification.success) {
    logger.warn({
      message: 'Guest payment verification failed',
      reference: snapshot.gatewayReference,
      gateway: snapshot.gateway,
      error: verification.error,
      code: verification.code,
    });
    return NextResponse.json(
      {
        success: false,
        status: 'pending',
        error: verification.error,
        orderNumber: derivedOrderNumber,
      },
      { status: 400 }
    );
  }

  if (verification.status !== 'success') {
    // Terminal provider outcome (failed/cancelled/abandoned): carry the
    // proof-bound order identity so clients attribute this envelope to
    // their order instead of treating it as transient.
    return NextResponse.json({
      success: false,
      status: verification.status,
      orderId: snapshot.orderId,
      orderNumber: derivedOrderNumber,
    });
  }

  // Verify the gateway-confirmed amount matches the stored transaction
  // amount (mirrors the session path's partial-pay exploit guard).
  const verifiedAmount = getVerifiedAmount(
    snapshot.gateway,
    verification.gatewayResponse
  );

  if (verifiedAmount) {
    if (Math.abs(verifiedAmount.amount - snapshot.amount) > 0.01) {
      logger.error({
        message: 'Guest payment verify route amount mismatch',
        reference: snapshot.gatewayReference,
        gateway: snapshot.gateway,
        expected: snapshot.amount,
        received: verifiedAmount.amount,
      });
      return NextResponse.json(
        {
          error: 'Payment amount mismatch',
          code: 'amount_mismatch',
          reference: snapshot.gatewayReference,
        },
        { status: 400 }
      );
    }

    if (
      snapshot.currency &&
      verifiedAmount.currency &&
      snapshot.currency.toUpperCase() !== verifiedAmount.currency.toUpperCase()
    ) {
      logger.error({
        message: 'Guest payment verify route currency mismatch',
        reference: snapshot.gatewayReference,
        gateway: snapshot.gateway,
        expected: snapshot.currency,
        received: verifiedAmount.currency,
      });
      return NextResponse.json(
        {
          error: 'Payment currency mismatch',
          code: 'currency_mismatch',
          reference: snapshot.gatewayReference,
        },
        { status: 400 }
      );
    }
  }

  // Gateway-confirmed but not yet finalized: finalization (invoice
  // partials, the atomic order flip, outbox side effects) belongs to the
  // gateway webhook / service boundary, never to a sessionless
  // user-facing request. Report pending with the proof-bound identity so
  // settlement polling converges once the webhook lands.
  return NextResponse.json({
    success: false,
    status: 'pending',
    orderId: snapshot.orderId,
    orderNumber: derivedOrderNumber,
  });
}
