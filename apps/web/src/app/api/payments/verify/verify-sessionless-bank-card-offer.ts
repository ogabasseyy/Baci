import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { createStorefrontOrderRpcClient } from '@/lib/checkout/storefront-order-rpc-client';
import { verifyBankCardOfferPaystack } from '@/lib/checkout/verify-bank-card-offer-paystack';
import { logger } from '@/lib/logger';
import { bankCardOfferVerificationContextSchema } from '@/schemas/bank-card-offer-verification-context';
import type { GuestPaymentReferenceSnapshot } from './guest-payment-reference-snapshot';

function getRecordedCaptureOutcome(snapshot: GuestPaymentReferenceSnapshot) {
  if (snapshot.transactionStatus !== 'completed') return null;

  const payment = snapshot.orderPaymentStatus?.toLowerCase();
  const shipping = snapshot.orderShippingStatus?.toLowerCase();
  if (
    payment === 'cancelled' ||
    payment === 'canceled' ||
    shipping === 'cancelled' ||
    shipping === 'canceled'
  ) {
    return 'order_cancelled';
  }
  if (payment === 'refunded') return 'order_skipped';
  return payment === 'paid' && snapshot.inventoryConfirmed ? 'completed' : null;
}

export async function verifySessionlessBankCardOffer(
  snapshot: GuestPaymentReferenceSnapshot,
  buyerClient: SupabaseClient,
  createScopedClient: typeof createStorefrontOrderRpcClient
) {
  const orderDetails = {
    orderId: snapshot.orderId,
    orderNumber: snapshot.orderNumber ?? undefined,
  };
  const pending = () =>
    NextResponse.json(
      { ...orderDetails, success: false, status: 'pending' },
      { status: 202 }
    );

  const unavailable = () =>
    NextResponse.json({ error: 'Verification unavailable' }, { status: 503 });

  if (snapshot.gateway !== 'paystack') {
    return NextResponse.json(
      { error: 'Invalid bank offer capture' },
      { status: 400 }
    );
  }

  const args = {
    p_order_id: snapshot.orderId,
    p_merchant_id: snapshot.merchantId,
    p_transaction_id: snapshot.transactionId,
  };
  try {
    const client = createScopedClient({
      fallbackClient: buyerClient,
      hasCanonicalDeliveryMetadata: false,
      merchantId: snapshot.merchantId,
      userId: null,
    });
    const { data, error } = await client.rpc(
      'get_bank_card_offer_verification_context',
      args
    );
    const saved = bankCardOfferVerificationContextSchema.safeParse(data);
    if (
      error ||
      !saved.success ||
      saved.data.reference !== snapshot.gatewayReference ||
      saved.data.quote.merchantId !== snapshot.merchantId
    )
      return pending();

    const { amountKobo, quote } = saved.data;
    const verified = await verifyBankCardOfferPaystack({
      ...saved.data,
      currency: 'NGN',
      adjustmentsKobo:
        amountKobo - (quote.productSubtotalKobo - quote.discountKobo),
    });
    if (verified?.kind === 'unavailable') {
      logger.warn({
        message: 'Paystack bank offer verification unavailable',
        orderId: snapshot.orderId,
      });
      return NextResponse.json(
        { error: 'Verification unavailable' },
        { status: 503, headers: { 'Retry-After': '15' } }
      );
    }
    if (verified?.kind === 'terminal') {
      const review = await client.rpc('flag_bank_card_offer_terminal_review', {
        ...args,
        p_status: verified.status,
        ...(verified.reportedReversalAmountKobo !== undefined
          ? { p_reported_amount_kobo: verified.reportedReversalAmountKobo }
          : {}),
      });
      if (review.error || review.data !== true) return unavailable();
      return NextResponse.json({
        ...orderDetails,
        success: false,
        status: verified.status,
        ...(verified.status === 'reversed'
          ? { reference: saved.data.reference }
          : {}),
      });
    }
    if (verified?.kind === 'mismatch') {
      const review = await client.rpc(
        'flag_bank_card_offer_capture_review',
        args
      );
      if (review.error || review.data !== true) {
        logger.warn({
          message: 'Bank offer capture review unavailable',
          orderId: snapshot.orderId,
          error: review.error,
        });
        return unavailable();
      }
      return NextResponse.json(
        {
          ...orderDetails,
          code: 'BANK_CARD_OFFER_CAPTURE_REVIEW',
          success: false,
          status: 'pending',
        },
        { status: 202 }
      );
    }
    if (verified?.kind !== 'verified') return pending();

    // The provider proof and completed transaction establish capture. A
    // terminal order remains closed and the caller shows reconciliation.
    const finalizationOutcome = getRecordedCaptureOutcome(snapshot);
    if (finalizationOutcome) {
      return NextResponse.json({
        ...orderDetails,
        success: true,
        status: 'success',
        paymentMethod: snapshot.gateway,
        ...(snapshot.orderTotal !== null
          ? { orderTotal: snapshot.orderTotal }
          : {}),
        currency: 'NGN',
        finalizationOutcome,
      });
    }
    const recovery = await buyerClient.rpc(
      'ensure_bank_card_offer_capture_sweep',
      {
        p_reference: snapshot.gatewayReference,
      }
    );
    return !recovery.error && recovery.data === true
      ? pending()
      : unavailable();
  } catch (error) {
    logger.warn({
      message: 'Bank offer shopper verification unavailable',
      orderId: snapshot.orderId,
      error,
    });
    return unavailable();
  }
}
