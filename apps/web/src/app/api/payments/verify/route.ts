import { after, type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { ensurePaidOrderInventoryConfirmed } from '@/lib/payments/ensure-paid-order-inventory-confirmed';
import { finalizeOrderGatewayPayment } from '@/lib/payments/finalize-order-gateway-payment';
import { buildInventoryConfirmationFailurePayload } from '@/lib/payments/inventory-confirmation-response';
import { processMerchantInvoicePartialPayment } from '@/lib/payments/process-merchant-invoice-partial-payment';
import type { GatewayVerificationResult } from '@/lib/payments/types';
import { createServiceClient } from '@/lib/supabase/service';
import { referenceSchema, verifyPaymentBodySchema } from '@/schemas/payments';
import { authorizeSessionlessVerifyReference } from './authorize-verify-reference';
import {
  getVerifiedAmount,
  verifyGatewayPayment,
} from './verify-gateway-payment';
import { verifyGuestPaymentReferenceByQuery } from './verify-guest-payment-reference';

// Read-only guest verification: CSRF validation covers non-GET requests
// only, so sessionless callers prove their order here with the
// creation tracking token (narrow snapshot RPC, no service client)
// instead of POSTing through a CSRF failure.
export function GET(request: NextRequest) {
  return verifyGuestPaymentReferenceByQuery(request.nextUrl.searchParams);
}

async function verifyPaymentReference(
  reference: string,
  // Order the sessionless proof binds this reference to (tracking token
  // or validated user-customer relationship). The service-client lookup
  // below must name the same order, or the finalization target has
  // drifted from the authorized one. Absent for session requests, whose
  // CSRF-validated cookie is the authority.
  expectedOrderId?: string | null
) {
  const parsedReference = referenceSchema.safeParse(reference);

  if (!parsedReference.success) {
    return NextResponse.json({ error: 'Invalid reference' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: transaction, error: transactionError } = await supabase
    .from('transactions')
    .select(
      'id, order_id, merchant_id, amount, currency, status, gateway, gateway_reference, gateway_response, metadata, platform_fee'
    )
    .eq('gateway_reference', parsedReference.data)
    .maybeSingle();

  if (transactionError || !transaction) {
    logger.warn({
      message: 'Payment verification transaction lookup failed',
      reference: parsedReference.data,
      error: transactionError,
    });
    // Permanent for this reference: no webhook or poll can materialize a
    // transaction row that the provider never created. The machine code
    // plus the echoed reference let native callers fail terminally
    // instead of confirming an unverifiable attempt as transient.
    return NextResponse.json(
      {
        error: 'Transaction not found',
        code: 'reference_not_found',
        reference: parsedReference.data,
      },
      { status: 404 }
    );
  }

  const { data: existingOrder } = transaction.order_id
    ? await supabase
        .from('orders')
        .select('id, order_number, payment_status, shipping_status, total')
        .eq('id', transaction.order_id)
        .maybeSingle()
    : { data: null };

  if (expectedOrderId && transaction.order_id !== expectedOrderId) {
    // The reference resolved to a different order than the sessionless
    // proof authorized (stale binding, or a reference swapped between the
    // proof check and this read). Fail closed with no existence oracle —
    // identical to the proof denial below.
    logger.warn({
      message: 'Payment verification order binding mismatch',
      reference: parsedReference.data,
    });
    return NextResponse.json(
      { error: 'Verification unavailable' },
      { status: 403 }
    );
  }

  if (!transaction.order_id) {
    // Wallet top-ups and other non-order references have their own
    // verification flows. Flipping the transaction here would make the
    // gateway webhook short-circuit on the completed row without ever
    // running that flow's crediting logic — refuse instead of finalizing.
    logger.warn({
      message: 'Payment verify called for a transaction without an order',
      reference: parsedReference.data,
    });
    // Permanent for this reference: a non-order transaction can never
    // settle an order. Same machine-code contract as above.
    return NextResponse.json(
      {
        error: 'Transaction is not an order payment',
        code: 'reference_not_order_payment',
        reference: parsedReference.data,
      },
      { status: 409 }
    );
  }

  const isSupportedOrderGateway =
    transaction.gateway === 'paystack' || transaction.gateway === 'korapay';
  const isJuicywayLocallyFinalizedOrderPayment =
    transaction.gateway === 'juicyway' &&
    transaction.status === 'completed' &&
    existingOrder?.payment_status === 'paid';
  if (isJuicywayLocallyFinalizedOrderPayment) {
    try {
      await ensurePaidOrderInventoryConfirmed(
        supabase,
        transaction.merchant_id,
        transaction.order_id
      );
    } catch (inventoryError) {
      logger.error({
        error: inventoryError,
        message:
          'Completed Juicyway payment inventory confirmation failed during verification',
        orderId: transaction.order_id,
        reference: parsedReference.data,
      });
      const payload = buildInventoryConfirmationFailurePayload(inventoryError);
      return NextResponse.json(payload, {
        status: payload.code === 'serialized_inventory_unavailable' ? 409 : 500,
      });
    }
    const juicywayTotal = Number(existingOrder?.total);
    const juicywayCurrency =
      typeof transaction.currency === 'string'
        ? transaction.currency.trim().toUpperCase()
        : '';
    return NextResponse.json({
      orderId: transaction.order_id,
      paymentMethod: transaction.gateway,
      success: true,
      status: 'success',
      orderNumber:
        existingOrder.order_number ||
        transaction.gateway_reference.slice(0, 8).toUpperCase(),
      ...(Number.isFinite(juicywayTotal) ? { orderTotal: juicywayTotal } : {}),
      ...(juicywayCurrency ? { currency: juicywayCurrency } : {}),
      // Locally-finalized paid order: semantically a completed finalization.
      finalizationOutcome: 'completed',
    });
  }
  const storedGatewayResponse = transaction.gateway_response;
  const hasStoredGatewayResponse =
    storedGatewayResponse !== null &&
    typeof storedGatewayResponse === 'object' &&
    !Array.isArray(storedGatewayResponse);
  const isLocallyFinalizedOrderPayment =
    isSupportedOrderGateway &&
    transaction.status === 'completed' &&
    existingOrder?.payment_status === 'paid' &&
    hasStoredGatewayResponse;
  const verification: GatewayVerificationResult = isLocallyFinalizedOrderPayment
    ? {
        gatewayResponse: storedGatewayResponse as Record<string, unknown>,
        status: 'success',
        success: true,
      }
    : await verifyGatewayPayment(transaction.gateway, parsedReference.data);

  if (!verification.success) {
    logger.warn({
      message: 'Payment verification failed',
      reference: parsedReference.data,
      gateway: transaction.gateway,
      error: verification.error,
      code: verification.code,
    });
    return NextResponse.json(
      {
        success: false,
        status: 'pending',
        error: verification.error,
        orderNumber:
          existingOrder?.order_number ||
          transaction.gateway_reference.slice(0, 8).toUpperCase(),
      },
      { status: 400 }
    );
  }

  if (verification.status !== 'success') {
    // Terminal provider outcome (failed/cancelled/abandoned): carry the
    // trusted order identity resolved from the reference's transaction
    // row so clients can attribute this envelope to their order instead
    // of treating it as transient and confirming a payment that cannot
    // settle.
    return NextResponse.json({
      success: false,
      status: verification.status,
      orderId: transaction.order_id,
      orderNumber:
        existingOrder?.order_number ||
        transaction.gateway_reference.slice(0, 8).toUpperCase(),
    });
  }

  // Verify the gateway-confirmed amount matches our stored transaction amount
  // (mirrors the webhook's amount/currency checks to prevent partial-pay exploits)
  const verifiedAmount = getVerifiedAmount(
    transaction.gateway,
    verification.gatewayResponse
  );

  if (verifiedAmount) {
    const transactionAmount = Number(transaction.amount) || 0;
    if (Math.abs(verifiedAmount.amount - transactionAmount) > 0.01) {
      logger.error({
        message: 'Payment verify route amount mismatch',
        reference: parsedReference.data,
        gateway: transaction.gateway,
        expected: transactionAmount,
        received: verifiedAmount.amount,
      });
      // Permanent for this attempt: the provider-confirmed amount differs
      // from the stored transaction, so this reference can never settle
      // the order. Same machine-code contract as the 404/409 envelopes.
      return NextResponse.json(
        {
          error: 'Payment amount mismatch',
          code: 'amount_mismatch',
          reference: parsedReference.data,
        },
        { status: 400 }
      );
    }

    const expectedCurrency =
      typeof transaction.currency === 'string' ? transaction.currency : null;
    if (
      expectedCurrency &&
      verifiedAmount.currency &&
      expectedCurrency.toUpperCase() !== verifiedAmount.currency.toUpperCase()
    ) {
      logger.error({
        message: 'Payment verify route currency mismatch',
        reference: parsedReference.data,
        gateway: transaction.gateway,
        expected: expectedCurrency,
        received: verifiedAmount.currency,
      });
      // Permanent for this attempt, like the amount mismatch above.
      return NextResponse.json(
        {
          error: 'Payment currency mismatch',
          code: 'currency_mismatch',
          reference: parsedReference.data,
        },
        { status: 400 }
      );
    }
  }

  const merchantInvoicePartialPayment =
    await processMerchantInvoicePartialPayment({
      gateway: transaction.gateway as 'korapay' | 'paystack',
      gatewayResponse: verification.gatewayResponse,
      reference: parsedReference.data,
      supabase,
      transaction: {
        amount: transaction.amount,
        currency: transaction.currency,
        gateway_reference: transaction.gateway_reference,
        id: transaction.id,
        merchant_id: transaction.merchant_id,
        metadata: transaction.metadata,
        order_id: transaction.order_id,
        platform_fee: transaction.platform_fee,
      },
    });
  if (merchantInvoicePartialPayment.kind !== 'none') {
    return NextResponse.json(merchantInvoicePartialPayment.body, {
      status: merchantInvoicePartialPayment.status,
    });
  }

  // Shared finalizer with the gateway webhook and the reconcile cron: the
  // transaction flip + order flip commit atomically inside the
  // complete_order_gateway_payment RPC, and receipt email / settlement /
  // ad tracking run through the claim-gated outbox — so whichever of verify
  // and the webhook wins the race, every side effect runs exactly once.
  // `transaction.gateway` is narrowed by verifyGatewayPayment above, which
  // rejects everything except paystack/korapay.
  const finalizeOutcome = await finalizeOrderGatewayPayment({
    actor: `verify:${parsedReference.data}`,
    gateway: transaction.gateway as 'paystack' | 'korapay',
    gatewayResponse: verification.gatewayResponse,
    orderId: transaction.order_id,
    reference: parsedReference.data,
    scheduleAfter: (task) => after(task),
    supabase,
    transaction: {
      amount: transaction.amount,
      gateway_reference: transaction.gateway_reference ?? null,
      id: transaction.id,
      merchant_id: transaction.merchant_id,
      order_id: transaction.order_id,
      platform_fee: transaction.platform_fee,
    },
    wonTransactionFlip: transaction.status !== 'completed',
  });

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
      orderId: transaction.order_id,
      outcome: finalizeOutcome.kind,
      reference: parsedReference.data,
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
    transaction.gateway_reference.slice(0, 8).toUpperCase();

  const verifiedTotal = Number(existingOrder?.total);
  const verifiedCurrency =
    typeof transaction.currency === 'string'
      ? transaction.currency.trim().toUpperCase()
      : '';
  return NextResponse.json({
    orderId: transaction.order_id,
    paymentMethod: transaction.gateway,
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

  // checkCsrfProtection accepts any syntactic `Authorization: Bearer ...`
  // (mobile callers hold no CSRF token), so a Bearer-carrying request is
  // sessionless whatever string it bears: bind its reference to the
  // caller — tracking-token proof or validated user-customer relationship
  // — before the service-client read/finalization path below. Session
  // (cookie-CSRF) requests carry no such header and keep their existing
  // authority. Denials are uniform (no existence oracle).
  const authorizationHeader = request.headers.get('authorization');
  if (authorizationHeader && /^bearer\s+.+$/i.test(authorizationHeader)) {
    const authorization = await authorizeSessionlessVerifyReference(
      request,
      parsedBody.data.reference,
      parsedBody.data.trackingToken
    );
    if (!authorization.authorized) {
      return NextResponse.json(
        { error: 'Verification unavailable' },
        { status: 403 }
      );
    }
    return verifyPaymentReference(
      parsedBody.data.reference,
      authorization.orderId
    );
  }

  return verifyPaymentReference(parsedBody.data.reference);
}
