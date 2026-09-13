import { after, type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { verifyPayment as verifyKorapayPayment } from '@/lib/korapay';
import { logger } from '@/lib/logger';
import { ensurePaidOrderInventoryConfirmed } from '@/lib/payments/ensure-paid-order-inventory-confirmed';
import { finalizeOrderGatewayPayment } from '@/lib/payments/finalize-order-gateway-payment';
import { buildInventoryConfirmationFailurePayload } from '@/lib/payments/inventory-confirmation-response';
import { processMerchantInvoicePartialPayment } from '@/lib/payments/process-merchant-invoice-partial-payment';
import type { GatewayVerificationResult } from '@/lib/payments/types';
import { verifyTransaction as verifyPaystackPayment } from '@/lib/paystack';
import { createServiceClient } from '@/lib/supabase/service';
import { referenceSchema, verifyPaymentBodySchema } from '@/schemas/payments';

function getVerifiedAmount(
  gateway: string,
  gatewayResponse: Record<string, unknown>
): { amount: number; currency?: string } | null {
  const rawAmount = gatewayResponse.amount;
  if (
    typeof rawAmount !== 'number' ||
    !Number.isFinite(rawAmount) ||
    rawAmount <= 0
  ) {
    return null;
  }

  const currency =
    typeof gatewayResponse.currency === 'string'
      ? gatewayResponse.currency
      : undefined;
  // Paystack returns amounts in kobo (smallest unit), divide by 100
  const amount = gateway === 'paystack' ? rawAmount / 100 : rawAmount;

  return { amount, currency };
}

async function verifyGatewayPayment(
  gateway: string,
  reference: string
): Promise<GatewayVerificationResult> {
  if (gateway === 'paystack') {
    const result = await verifyPaystackPayment(reference);
    if (!result.success) {
      return result;
    }

    return {
      success: true,
      status: result.data.status,
      gatewayResponse: result.data as unknown as Record<string, unknown>,
    };
  }

  if (gateway === 'korapay') {
    const result = await verifyKorapayPayment(reference);
    if (!result.success) {
      return result;
    }

    return {
      success: true,
      status: result.data.status,
      gatewayResponse: result.data as unknown as Record<string, unknown>,
    };
  }

  return {
    success: false,
    error: `Unsupported gateway: ${gateway}`,
    code: 'UNSUPPORTED_GATEWAY',
  };
}

async function verifyPaymentReference(reference: string) {
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
    return NextResponse.json(
      { error: 'Transaction not found' },
      { status: 404 }
    );
  }

  const { data: existingOrder } = transaction.order_id
    ? await supabase
        .from('orders')
        .select('id, order_number, payment_status, shipping_status')
        .eq('id', transaction.order_id)
        .maybeSingle()
    : { data: null };

  if (!transaction.order_id) {
    // Wallet top-ups and other non-order references have their own
    // verification flows. Flipping the transaction here would make the
    // gateway webhook short-circuit on the completed row without ever
    // running that flow's crediting logic — refuse instead of finalizing.
    logger.warn({
      message: 'Payment verify called for a transaction without an order',
      reference: parsedReference.data,
    });
    return NextResponse.json(
      { error: 'Transaction is not an order payment' },
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
    return NextResponse.json({
      success: true,
      status: 'success',
      orderNumber:
        existingOrder.order_number ||
        transaction.gateway_reference.slice(0, 8).toUpperCase(),
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
    return NextResponse.json({
      success: false,
      status: verification.status,
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
      return NextResponse.json(
        { error: 'Payment amount mismatch' },
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
      return NextResponse.json(
        { error: 'Payment currency mismatch' },
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
    return NextResponse.json(
      { error: 'Failed to finalize order' },
      { status: 500 }
    );
  }

  if (finalizeOutcome.kind === 'inventory_failed') {
    return NextResponse.json(finalizeOutcome.payload, {
      status: finalizeOutcome.status,
    });
  }

  if (finalizeOutcome.kind === 'inventory_cleanup_failed') {
    return NextResponse.json(
      {
        code: 'INVENTORY_CONFIRMATION_CLEANUP_FAILED',
        error: 'Inventory confirmation cleanup failed',
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

  return NextResponse.json({
    success: true,
    status: 'success',
    orderNumber: finalOrderNumber,
  });
}

export function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST to verify a payment.' },
    { headers: { Allow: 'POST' }, status: 405 }
  );
}

export async function POST(request: NextRequest) {
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) {
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
    );
  }

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

  return verifyPaymentReference(parsedBody.data.reference);
}
