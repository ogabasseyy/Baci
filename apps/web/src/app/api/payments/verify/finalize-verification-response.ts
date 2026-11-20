import type { SupabaseClient } from '@supabase/supabase-js';
import { after, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import type { finalizeOrderGatewayPayment } from '@/lib/payments/finalize-order-gateway-payment';

export async function finalizeVerificationResponse(
  {
    reference,
    gateway,
    orderId,
    transaction,
    existingOrder,
    gatewayResponse,
    isBankOfferReference = false,
    supabase,
  }: {
    reference: string;
    gateway: 'paystack' | 'korapay';
    orderId: string;
    transaction: {
      amount: number;
      currency: string | null;
      gateway_reference: string;
      id: string;
      merchant_id: string;
      platform_fee: number | null;
      status: string;
    };
    existingOrder: { order_number: string | null; total: number | null } | null;
    gatewayResponse?: Record<string, unknown>;
    isBankOfferReference?: boolean;
    supabase: SupabaseClient;
  },
  finalize: typeof finalizeOrderGatewayPayment
) {
  // Shared finalizer with the gateway webhook and the reconcile cron: the
  // transaction flip + order flip commit atomically inside the
  // complete_order_gateway_payment RPC, and receipt email / settlement /
  // ad tracking run through the claim-gated outbox — so whichever of verify
  // and the webhook wins the race, every side effect runs exactly once.
  // For bank offers the finalizer verifies the reference against the saved offer.
  const finalizeOutcome = await finalize({
    actor: `verify:${reference}`,
    gateway: gateway,
    gatewayResponse,
    orderId,
    reference: reference,
    scheduleAfter: (task) => after(task),
    supabase,
    transaction: {
      amount: transaction.amount,
      gateway_reference: transaction.gateway_reference ?? null,
      id: transaction.id,
      merchant_id: transaction.merchant_id,
      order_id: orderId,
      platform_fee: transaction.platform_fee,
    },
    wonTransactionFlip:
      !isBankOfferReference && transaction.status !== 'completed',
  });

  if (finalizeOutcome.kind === 'bank_offer_terminal') {
    return NextResponse.json({
      success: false,
      status: finalizeOutcome.status,
      orderId,
      orderNumber: existingOrder?.order_number ?? undefined,
    });
  }
  if (finalizeOutcome.kind === 'bank_offer_capture_review') {
    return NextResponse.json(
      {
        code: 'BANK_CARD_OFFER_CAPTURE_REVIEW',
        orderId,
        orderNumber: existingOrder?.order_number ?? undefined,
        status: 'pending',
      },
      { status: 202 }
    );
  }

  if (
    finalizeOutcome.kind === 'captured_held' ||
    finalizeOutcome.kind === 'capture_evidence_review'
  ) {
    return NextResponse.json(
      {
        code:
          finalizeOutcome.kind === 'captured_held'
            ? 'REDVAULT_CAPTURE_HELD'
            : 'REDVAULT_CAPTURE_EVIDENCE_REVIEW',
        error:
          finalizeOutcome.kind === 'captured_held'
            ? 'Payment capture is pending eligibility confirmation'
            : 'Payment capture evidence requires review',
        orderNumber:
          existingOrder?.order_number ||
          transaction.gateway_reference.slice(0, 8).toUpperCase(),
        status: 'pending',
      },
      { status: 202 }
    );
  }

  if (
    finalizeOutcome.kind === 'capture_hold_failed' ||
    finalizeOutcome.kind === 'completion_failed' ||
    finalizeOutcome.kind === 'order_fetch_failed' ||
    // Captured money that must not reopen the order, with no ops trail:
    // fail closed so the caller retries rather than reporting success.
    finalizeOutcome.kind === 'review_failed'
  ) {
    logger.error({
      error:
        'error' in finalizeOutcome
          ? finalizeOutcome.error
          : finalizeOutcome.kind,
      message: 'Payment verify route failed to finalize order payment',
      orderId,
      outcome: finalizeOutcome.kind,
      reference: reference,
    });
    // Tag the finalization outcome: the provider already captured the
    // money, so callers must treat these as pending (reconciliation or a
    // later reverify can still complete), never as payment failures.
    return NextResponse.json(
      {
        error: 'Failed to finalize order',
        finalizationOutcome: finalizeOutcome.kind,
      },
      { status: 500 }
    );
  }

  if (finalizeOutcome.kind === 'inventory_failed') {
    return NextResponse.json(
      {
        ...finalizeOutcome.payload,
        finalizationOutcome: finalizeOutcome.kind,
      },
      {
        status: finalizeOutcome.status,
      }
    );
  }

  if (finalizeOutcome.kind === 'inventory_cleanup_failed') {
    return NextResponse.json(
      {
        code: 'INVENTORY_CONFIRMATION_CLEANUP_FAILED',
        error: 'Inventory confirmation cleanup failed',
        finalizationOutcome: finalizeOutcome.kind,
      },
      { status: 500 }
    );
  }

  // 'completed', 'order_cancelled' (reconciliation review filed inside the
  // finalizer) and 'order_skipped' (refunded — review filed too) all report
  // success to the caller: their payment was captured and recorded.
  const finalOrderNumber =
    ('orderNumber' in finalizeOutcome ? finalizeOutcome.orderNumber : null) ||
    existingOrder?.order_number ||
    (isBankOfferReference
      ? undefined
      : transaction.gateway_reference.slice(0, 8).toUpperCase());

  const verifiedTotal = Number(existingOrder?.total);
  const verifiedCurrency =
    typeof transaction.currency === 'string'
      ? transaction.currency.trim().toUpperCase()
      : '';
  return NextResponse.json({
    orderId,
    paymentMethod: gateway,
    success: true,
    status: 'success',
    orderNumber: finalOrderNumber,
    // Lets the success page attribute revenue without a second lookup.
    ...(Number.isFinite(verifiedTotal) ? { orderTotal: verifiedTotal } : {}),
    ...(verifiedCurrency ? { currency: verifiedCurrency } : {}),
    // completed = active paid order; order_cancelled/order_skipped report
    // success too (money captured) but must not count as paid conversions.
    finalizationOutcome: finalizeOutcome.kind,
  });
}
