import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { ensurePaidOrderInventoryConfirmed } from '@/lib/payments/ensure-paid-order-inventory-confirmed';
import { buildInventoryConfirmationFailurePayload } from '@/lib/payments/inventory-confirmation-response';
import { processMerchantInvoicePartialPayment } from '@/lib/payments/process-merchant-invoice-partial-payment';
import { resolvePaidOrderCheckoutCapture } from '@/lib/payments/resolve-paid-order-checkout-capture';
import type { GatewayVerificationResult } from '@/lib/payments/types';
import { referenceSchema } from '@/schemas/payments';
import type { PaymentVerificationDependencies } from './payment-verification-dependencies';
import {
  getVerifiedAmount,
  verifyGatewayPayment,
} from './verify-gateway-payment';

export async function verifyPaymentReference(
  reference: string,
  { load, finalize }: PaymentVerificationDependencies
) {
  const parsedReference = referenceSchema.safeParse(reference);
  if (!parsedReference.success) {
    return NextResponse.json({ error: 'Invalid reference' }, { status: 400 });
  }
  const lookup = await load(parsedReference.data);
  if (!lookup.ok) return lookup.response;
  const { supabase, transaction } = lookup;

  const { data: existingOrder } = transaction.order_id
    ? await supabase
        .from('orders')
        .select('id, order_number, payment_status, shipping_status, total')
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

  if (
    transaction.gateway === 'paystack' &&
    !isLocallyFinalizedOrderPayment &&
    typeof verification.gatewayResponse.requested_amount === 'number' &&
    verification.gatewayResponse.requested_amount !==
      verification.gatewayResponse.amount
  ) {
    const capture = await resolvePaidOrderCheckoutCapture({
      reference: parsedReference.data,
      gatewayResponse: verification.gatewayResponse,
      supabase,
    });
    if (capture === 'unavailable' || capture === 'awaiting_evidence') {
      return NextResponse.json(
        { error: 'Payment capture reconciliation temporarily unavailable' },
        { status: 503 }
      );
    }
    if (capture === 'review' || capture === 'unapplied') {
      return NextResponse.json(
        {
          error: 'Payment capture requires review',
          code: 'PAID_ORDER_CAPTURE_REQUIRES_REVIEW',
        },
        { status: 409 }
      );
    }
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

  return finalize({
    reference: parsedReference.data,
    gateway: transaction.gateway as 'paystack' | 'korapay',
    orderId: transaction.order_id,
    transaction,
    existingOrder,
    gatewayResponse: verification.gatewayResponse,
    supabase,
  });
}
