import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import type { GatewayVerificationResult } from '@/lib/payments/types';
import { createAnonClient } from '@/lib/supabase/anon';
import {
  getVerifiedAmount,
  verifyGatewayPayment,
} from './verify-gateway-payment';

/**
 * Proof-bound guest read model: the reference's transaction plus its
 * order, returned only when the reference belongs to an order carrying
 * the supplied tracking token (enforced inside the
 * `get_guest_payment_reference_snapshot` RPC — zero rows otherwise, so
 * a valid reference is indistinguishable from a bogus one).
 */
export interface GuestPaymentReferenceSnapshot {
  transactionId: string;
  orderId: string;
  merchantId: string;
  amount: number;
  currency: string | null;
  transactionStatus: string;
  gateway: string;
  gatewayReference: string;
  orderNumber: string | null;
  orderPaymentStatus: string | null;
  orderShippingStatus: string | null;
  orderTotal: number | null;
  /**
   * True only when every serialized-tracked order item is durably held
   * in at least its ordered quantity (see the snapshot RPC). Paid row
   * alone is not success: the finalizer flips payment_status before the
   * inventory-confirm step converges.
   */
  inventoryConfirmed: boolean;
}

function toFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toSnapshot(
  row: Record<string, unknown>
): GuestPaymentReferenceSnapshot | null {
  if (
    typeof row.transaction_id !== 'string' ||
    typeof row.order_id !== 'string' ||
    typeof row.merchant_id !== 'string' ||
    typeof row.gateway_reference !== 'string'
  ) {
    return null;
  }
  const amount = toFiniteNumber(row.amount);
  if (amount === null) {
    return null;
  }
  return {
    transactionId: row.transaction_id,
    orderId: row.order_id,
    merchantId: row.merchant_id,
    amount,
    currency: typeof row.currency === 'string' ? row.currency : null,
    transactionStatus:
      typeof row.transaction_status === 'string' ? row.transaction_status : '',
    gateway: typeof row.gateway === 'string' ? row.gateway : '',
    gatewayReference: row.gateway_reference,
    orderNumber: typeof row.order_number === 'string' ? row.order_number : null,
    orderPaymentStatus:
      typeof row.order_payment_status === 'string'
        ? row.order_payment_status
        : null,
    orderShippingStatus:
      typeof row.order_shipping_status === 'string'
        ? row.order_shipping_status
        : null,
    orderTotal: toFiniteNumber(row.order_total),
    // Fail closed when the column is absent (pre-migration row shape):
    // a paid order without the proof stays pending.
    inventoryConfirmed: row.inventory_confirmed === true,
  };
}

/**
 * Loads the guest snapshot over the anon client through the narrow
 * snapshot RPC. Returns null on mismatch, on malformed rows, and on
 * lookup errors (fail closed with no existence oracle). Never touches a
 * service-role table client.
 */
export async function getGuestPaymentReferenceSnapshot(
  reference: string,
  trackingToken: string
): Promise<GuestPaymentReferenceSnapshot | null> {
  try {
    const supabase = createAnonClient();
    const { data, error } = await supabase.rpc(
      'get_guest_payment_reference_snapshot',
      {
        p_gateway_reference: reference,
        p_tracking_token: trackingToken,
      }
    );
    if (error) {
      return null;
    }
    const row = Array.isArray(data) ? data[0] : null;
    if (!row || typeof row !== 'object') {
      return null;
    }
    return toSnapshot(row as Record<string, unknown>);
  } catch {
    return null;
  }
}

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
