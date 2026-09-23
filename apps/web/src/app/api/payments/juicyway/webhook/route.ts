import { formatOrderItemDisplayName } from '@baci/shared/lib';
import { after, type NextRequest, NextResponse } from 'next/server';
import { USDT_WALLET_TOP_UP_TRANSACTION_TYPE } from '@/lib/customer-wallet-account';
import {
  generateOrderConfirmationEmail,
  generateOrderConfirmationText,
} from '@/lib/email-templates';
import { isEventPipelineEnqueueEnabled } from '@/lib/events/event-pipeline-config';
import { notifyNewOrder, notifyPaymentReceived } from '@/lib/expo-push';
import {
  type JuicywayWebhookPayload,
  verifyWebhookSignature,
} from '@/lib/juicyway';
import { logger } from '@/lib/logger';
import { enqueueJuicywayOrderConversion } from '@/lib/payments/enqueue-juicyway-order-conversion';
import { ensurePaidOrderInventoryConfirmed } from '@/lib/payments/ensure-paid-order-inventory-confirmed';
import { fileInventoryConfirmationFailureReview } from '@/lib/payments/file-inventory-confirmation-review';
import {
  handlePaymentForCancelledOrder,
  isOrderClampedAsCancelled,
} from '@/lib/payments/handle-payment-for-cancelled-order';
import { shouldRequireJuicywaySettlementMetadata } from '@/lib/payments/juicyway-settlement-metadata-compatibility';
import { JUICYWAY_UNDERPAYMENT_TOLERANCE } from '@/lib/payments/juicyway-settlement-policy';
import { handleJuicywayWalletTopUpIfNeeded } from '@/lib/payments/juicyway-wallet-top-up';
import { recordJuicywayOrderSettlement } from '@/lib/payments/record-juicyway-order-settlement';
import { scheduleLegacyPurchaseConversion } from '@/lib/payments/schedule-legacy-purchase-conversion';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  type OrderForConversion,
  triggerPurchaseConversion,
} from '@/lib/trigger-purchase-conversion';
import { sendEmail } from '@/lib/zeptomail';

// Juicyway webhook IP whitelist (from docs)
const JUICYWAY_IPS = [
  '52.31.139.75',
  '52.49.173.169',
  '52.214.14.220',
  '18.203.70.158',
  '54.229.174.45',
  '52.212.54.134',
  '54.77.226.185',
  '52.18.78.91',
  '54.76.137.67',
  '52.51.85.69',
  '52.210.159.41',
];
const ELIGIBLE_ORDER_PAYMENT_STATUSES = [
  'failed',
  'partially_paid',
  'pending',
  'unpaid',
];

/**
 * Logs whether the request originates from a known Juicyway IP. This is
 * observability only — it does NOT gate the request (the caller logs and
 * continues on a miss). HMAC signature verification is the actual security
 * control; the IP list can lag Juicyway's infra and proxies rewrite the source.
 */
function isFromJuicywayIP(request: NextRequest): boolean {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  const ip = forwardedFor?.split(',')[0]?.trim() || realIP || '';

  // In development, allow all IPs
  if (process.env.NODE_ENV !== 'production') {
    return true;
  }

  return JUICYWAY_IPS.includes(ip);
}

export async function POST(request: NextRequest) {
  try {
    // Optional: IP whitelist check
    if (!isFromJuicywayIP(request)) {
      logger.warn({
        message: 'Juicyway webhook from non-whitelisted IP',
        ip:
          request.headers.get('x-forwarded-for') ||
          request.headers.get('x-real-ip'),
      });
      // Continue processing but log it - don't reject in case of proxy issues
    }

    // Get raw body for signature verification
    const rawBody = await request.text();
    const payload: JuicywayWebhookPayload = JSON.parse(rawBody);

    // Get business ID for signature verification
    const businessId = process.env.JUICYWAY_BUSINESS_ID;
    if (!businessId) {
      logger.error({ message: 'JUICYWAY_BUSINESS_ID not configured' });
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // Verify webhook signature
    const { checksum, event, data } = payload;
    const isValid = await verifyWebhookSignature(
      event,
      data as unknown as Record<string, unknown>,
      checksum,
      businessId
    );

    if (!isValid) {
      logger.warn({ message: 'Invalid Juicyway webhook signature' });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    logger.info({
      message: 'Juicyway webhook received (signature verified)',
      event,
      reference: data.reference,
    });

    const reference = data.reference;
    if (!reference) {
      return NextResponse.json({ error: 'Missing reference' }, { status: 400 });
    }

    const adminSupabase = createAdminClient();

    // Handle different event types
    if (event === 'payment.session.failed') {
      logger.info({
        message: 'Juicyway payment failed',
        reference: data.reference,
      });
      const { data: failedTransaction, error: failedLookupError } =
        await adminSupabase
          .from('transactions')
          .select('id, metadata, status')
          .eq('gateway_reference', reference)
          .eq('gateway', 'juicyway')
          .maybeSingle();
      if (failedLookupError) {
        logger.error({
          error: failedLookupError,
          message: 'Failed to load Juicyway transaction for failure event',
          reference,
        });
        return NextResponse.json(
          { error: 'Unable to record payment failure' },
          { status: 500 }
        );
      }
      const failedMetadata =
        failedTransaction?.metadata &&
        typeof failedTransaction.metadata === 'object'
          ? (failedTransaction.metadata as Record<string, unknown>)
          : null;
      if (
        failedTransaction?.status === 'pending' &&
        failedMetadata?.transaction_type === USDT_WALLET_TOP_UP_TRANSACTION_TYPE
      ) {
        const { error: failedUpdateError } = await adminSupabase
          .from('transactions')
          .update({
            gateway_response: data,
            status: 'failed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', failedTransaction.id)
          .eq('status', 'pending');
        if (failedUpdateError) {
          logger.error({
            error: failedUpdateError,
            message: 'Failed to mark Juicyway wallet top-up as failed',
            reference,
          });
          return NextResponse.json(
            { error: 'Unable to record payment failure' },
            { status: 500 }
          );
        }
      }
      return NextResponse.json({ message: 'Failure noted' });
    }

    if (event !== 'payment.session.succeeded') {
      logger.info({
        message: 'Ignoring non-success Juicyway event',
        event,
        reference: data.reference,
      });
      return NextResponse.json({ message: 'Event ignored' });
    }

    // Webhooks do not have a merchant session, so transaction discovery must
    // use the service-role client. The reference remains provider-signed.
    const { data: transaction, error: transactionError } = await adminSupabase
      .from('transactions')
      .select(
        // Δ-0a: `gateway_fee` is not a column on `transactions`. Juicyway
        // verify webhooks have no fee field either, so settlement passes 0
        // (matches existing semantics).
        'id, order_id, merchant_id, amount, platform_fee, status, metadata, created_at, updated_at'
      )
      .eq('gateway_reference', reference)
      .eq('gateway', 'juicyway')
      .single();

    if (transactionError || !transaction) {
      logger.error({
        message: 'Transaction not found for Juicyway webhook',
        reference,
        error: transactionError,
      });
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      );
    }

    const walletTopUpResponse = await handleJuicywayWalletTopUpIfNeeded({
      payment: data,
      reference,
      supabase: adminSupabase,
      transaction,
    });
    if (walletTopUpResponse) return walletTopUpResponse;

    const supabase = adminSupabase;

    // Check if already processed (idempotency). A completed transaction does
    // NOT guarantee the order flip landed — the ORD-260711-00NT-5 wedge
    // class: the order update failed after the flip and every redelivery
    // acked 200 forever. Re-read the order and fall through to heal it when
    // it is still unpaid.
    if (transaction.status === 'completed') {
      let healWedgedOrder = false;
      if (transaction.order_id) {
        const { data: completedOrder, error: completedOrderError } =
          await supabase
            .from('orders')
            .select(
              'id, order_number, total, currency, customer_id, customer_name, customer_email, customer_phone, shipping_address, order_items(id, product_id, condition, name, price, quantity, variant_name), ad_tracking, payment_status, shipping_status, cancelled_at'
            )
            .eq('id', transaction.order_id)
            .maybeSingle();

        if (completedOrderError) {
          // A failed re-read must not be acknowledged as "Already processed"
          // — that would consume the redelivery that could heal a wedge.
          logger.error({
            error: completedOrderError,
            message: 'Order state lookup failed on Juicyway redelivery',
            orderId: transaction.order_id,
          });
          if (isEventPipelineEnqueueEnabled()) {
            throw new Error('completed_order_lookup_failed', {
              cause: completedOrderError,
            });
          }
          return NextResponse.json(
            { error: 'Order state lookup failed' },
            { status: 500 }
          );
        }

        const completedOrderIsCancelled =
          isOrderClampedAsCancelled(completedOrder);
        if (completedOrderIsCancelled) {
          const reviewFiled = await handlePaymentForCancelledOrder({
            gatewayReference: reference,
            order: completedOrder ?? { id: transaction.order_id },
            reason:
              'Juicyway completed-transaction retry observed a cancelled order',
            transactionId: transaction.id,
          });
          if (!reviewFiled) {
            return NextResponse.json(
              { error: 'Payment reconciliation review unavailable' },
              { status: 500 }
            );
          }
        } else if (completedOrder?.payment_status === 'refunded') {
          const reviewFiled = await handlePaymentForCancelledOrder({
            gatewayReference: reference,
            issueType: 'payment_received_after_refund',
            order: completedOrder,
            reason:
              'Juicyway completed-transaction retry observed a refunded order',
            transactionId: transaction.id,
          });
          if (!reviewFiled) {
            return NextResponse.json(
              { error: 'Payment reconciliation review unavailable' },
              { status: 500 }
            );
          }
        } else if (
          isEventPipelineEnqueueEnabled() &&
          completedOrder?.payment_status === 'paid'
        ) {
          const conversionOrder: OrderForConversion = {
            ad_tracking: completedOrder.ad_tracking,
            currency: completedOrder.currency,
            customer_email: completedOrder.customer_email,
            customer_id: completedOrder.customer_id,
            customer_name: completedOrder.customer_name,
            customer_phone: completedOrder.customer_phone,
            id: completedOrder.id,
            occurredAt: transaction.updated_at,
            order_items: completedOrder.order_items,
            order_number: completedOrder.order_number,
            shipping_address: completedOrder.shipping_address,
            total: completedOrder.total ?? transaction.amount,
          };
          await triggerPurchaseConversion(
            createAdminClient(),
            transaction.merchant_id,
            conversionOrder,
            { deliveryMode: 'enqueue_only' }
          );
          // The prior response may have ended after durable enqueue but
          // before `after()` ran. Re-schedule on every idempotent webhook
          // retry while shadow fanout is enabled; legacy provider sends use
          // the stable order event ID (or GA4 transaction ID) for dedupe.
          scheduleLegacyPurchaseConversion({
            merchantId: transaction.merchant_id,
            order: conversionOrder,
            scheduleAfter: (task) => after(task),
            supabase: createAdminClient(),
          });
        } else {
          const completedOrderStatus = completedOrder?.payment_status;
          healWedgedOrder = Boolean(
            completedOrder &&
              completedOrderStatus !== 'paid' &&
              completedOrderStatus !== 'cancelled' &&
              completedOrderStatus !== 'refunded'
          );
        }
      }

      if (!healWedgedOrder) {
        logger.info({ message: 'Transaction already processed', reference });
        return NextResponse.json({ message: 'Already processed' });
      }

      // Fall through: the transaction UPDATE below re-completes idempotently,
      // the order UPDATE flips the wedged order to paid, and the paid-order
      // side effects (email/push/conversion) run for the first time. The
      // settlement upsert is idempotent on its unique key.
      logger.warn({
        message: 'Juicyway redelivery healing a wedged order payment',
        orderId: transaction.order_id,
        reference,
      });
    }

    // Validate the settled amount against what we expected at session creation.
    // Juicyway is a stablecoin rail, so `data.amount` is in session-currency
    // minor units (USDT/USDC cents) — NOT the NGN order total — and the locked
    // FX rate means the expected amount was computed at checkout time. Reject
    // underpaid/wrong-currency settlements instead of trusting the success
    // event blindly (every other gateway enforces an amount/currency match).
    const txnMetadata = (transaction.metadata ?? {}) as Record<string, unknown>;
    const expectedAmount = Number(txnMetadata.juicyway_expected_amount);
    const expectedCurrency =
      typeof txnMetadata.juicyway_expected_currency === 'string'
        ? txnMetadata.juicyway_expected_currency
        : null;
    const settledAmount = Number(data.amount);
    const settledCurrency =
      typeof data.currency === 'string' && data.currency.trim().length > 0
        ? data.currency.trim()
        : null;
    const hasExpectedSettlementMetadata =
      txnMetadata.juicyway_expected_amount != null ||
      txnMetadata.juicyway_expected_currency != null;
    const requireExpectedSettlementMetadata =
      hasExpectedSettlementMetadata ||
      shouldRequireJuicywaySettlementMetadata(
        (transaction as { created_at?: unknown }).created_at
      );

    if (!Number.isFinite(settledAmount) || settledAmount <= 0) {
      logger.error({
        message: 'Juicyway payment amount missing or invalid',
        reference,
        expected: expectedAmount,
        received: data.amount,
      });
      return NextResponse.json(
        { error: 'Payment amount mismatch' },
        { status: 400 }
      );
    }

    if (!settledCurrency) {
      logger.error({
        message: 'Juicyway settled currency missing or invalid',
        reference,
        received: data.currency,
      });
      return NextResponse.json(
        { error: 'Payment currency mismatch' },
        { status: 400 }
      );
    }

    if (requireExpectedSettlementMetadata) {
      if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
        logger.error({
          message: 'Juicyway expected amount missing; rejecting settlement',
          reference,
        });
        return NextResponse.json(
          { error: 'Payment amount mismatch' },
          { status: 400 }
        );
      }

      if (!expectedCurrency) {
        logger.error({
          message: 'Juicyway expected currency missing; rejecting settlement',
          reference,
          received: data.currency,
        });
        return NextResponse.json(
          { error: 'Payment currency mismatch' },
          { status: 400 }
        );
      }

      if (expectedCurrency.toUpperCase() !== settledCurrency.toUpperCase()) {
        logger.error({
          message: 'Juicyway payment currency mismatch',
          reference,
          expected: expectedCurrency,
          received: settledCurrency,
        });
        return NextResponse.json(
          { error: 'Payment currency mismatch' },
          { status: 400 }
        );
      }

      // Allow overpayment + dust; reject clear underpayment (>1% short).
      // Stablecoins are ~1:1 USD, so the locked-rate expectation is exact
      // and the tolerance only absorbs on-chain rounding/dust.
      if (
        settledAmount <
        expectedAmount * (1 - JUICYWAY_UNDERPAYMENT_TOLERANCE)
      ) {
        logger.error({
          message: 'Juicyway payment amount mismatch (underpaid)',
          reference,
          expected: expectedAmount,
          received: settledAmount,
          currency: settledCurrency,
        });
        return NextResponse.json(
          { error: 'Payment amount mismatch' },
          { status: 400 }
        );
      }
    } else {
      logger.warn({
        message:
          'Processing legacy Juicyway settlement without expected metadata',
        reference,
        received: settledAmount,
        currency: settledCurrency,
      });
    }

    // Update transaction status
    const { error: updateError } = await supabase
      .from('transactions')
      .update({
        status: 'completed',
        gateway_response: data as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq('id', transaction.id);

    if (updateError) {
      logger.error({
        message: 'Failed to update transaction',
        reference,
        error: updateError,
      });
      throw updateError;
    }

    let durableEnqueueError: unknown = null;

    // Update order status if order_id exists. The .neq('payment_status',
    // 'paid') CAS makes concurrent deliveries (or heal redeliveries racing
    // each other) resolve to exactly one winner — only the winner runs the
    // non-outbox side effects below (email/push/conversion have no claim
    // gating on this route). shipping_status is advanced separately and only
    // from 'pending' so a heal never regresses fulfilment progress.
    let orderUpdateFailed = false;
    if (transaction.order_id) {
      // Advance fulfilment FIRST (only from its initial state, so a heal
      // never regresses a shipped order). Ordering matters: if this write
      // fails or the process dies here, the order is still unpaid, so the
      // redelivery wedge check re-runs the whole sequence — whereas
      // advancing after the paid flip would leave a paid order stuck at
      // shipping 'pending' with redeliveries acking 'Already processed'.
      const { error: shippingAdvanceError } = await supabase
        .from('orders')
        .update({
          shipping_status: 'processing',
          updated_at: new Date().toISOString(),
        })
        .eq('id', transaction.order_id)
        .eq('shipping_status', 'pending')
        .in('payment_status', ELIGIBLE_ORDER_PAYMENT_STATUSES);
      if (shippingAdvanceError) {
        logger.error({
          error: shippingAdvanceError,
          message: 'Juicyway paid order shipping advance failed',
          orderId: transaction.order_id,
        });
        return NextResponse.json(
          {
            code: 'ORDER_PAYMENT_COMPLETION_FAILED',
            error: 'Order payment completion failed',
          },
          { status: 500 }
        );
      }

      const response = await supabase
        .from('orders')
        .update({
          payment_status: 'paid',
          updated_at: new Date().toISOString(),
        })
        .eq('id', transaction.order_id)
        .in('payment_status', ELIGIBLE_ORDER_PAYMENT_STATUSES)
        .select(
          'id, order_number, merchant_id, customer_id, total, subtotal, shipping_fee, customer_name, customer_email, customer_phone, shipping_address, currency, payment_status, shipping_status, cancelled_at, updated_at, ad_tracking, order_items(id, product_id, condition, name, price, quantity, variant_name)'
        )
        .maybeSingle();

      if (!response.error && !response.data) {
        const { data: terminalOrder, error: terminalOrderError } =
          await supabase
            .from('orders')
            .select(
              'id, payment_status, shipping_status, cancelled_at, order_number'
            )
            .eq('id', transaction.order_id)
            .maybeSingle();
        if (terminalOrderError || !terminalOrder) {
          return NextResponse.json(
            { error: 'Order state lookup failed' },
            { status: 500 }
          );
        }
        const terminalIssueType =
          terminalOrder.payment_status === 'refunded'
            ? 'payment_received_after_refund'
            : isOrderClampedAsCancelled(terminalOrder)
              ? 'payment_received_after_cancellation'
              : null;
        if (terminalIssueType) {
          const reviewFiled = await handlePaymentForCancelledOrder({
            gatewayReference: reference,
            issueType: terminalIssueType,
            order: terminalOrder,
            reason: `Juicyway payment captured for terminal order status ${terminalOrder.payment_status}`,
            transactionId: transaction.id,
          });
          if (!reviewFiled) {
            return NextResponse.json(
              { error: 'Payment reconciliation review unavailable' },
              { status: 500 }
            );
          }
          return NextResponse.json({
            message: 'Payment recorded; terminal order filed for review',
            success: true,
          });
        }

        if (terminalOrder.payment_status !== 'paid') {
          const reviewFiled = await handlePaymentForCancelledOrder({
            gatewayReference: reference,
            issueType: 'gateway_payment_wedge_requires_review',
            order: terminalOrder,
            reason: `Juicyway payment captured for an order in blocked payment status ${terminalOrder.payment_status}`,
            transactionId: transaction.id,
          });
          if (!reviewFiled) {
            return NextResponse.json(
              { error: 'Payment reconciliation review unavailable' },
              { status: 500 }
            );
          }
          return NextResponse.json({
            message: 'Payment recorded; blocked order filed for review',
            success: true,
          });
        }

        // 0 rows: the order is already paid — either a concurrent delivery
        // won the flip, or the order was paid through another channel before
        // this delivery. The Juicyway money IS captured (signature + amount
        // verified above) and the transaction row is completed, so a bare
        // ack would strand the settlement if the winner died before its own
        // settlement write. Record it here (idempotent upsert on the
        // settlement's unique key) and ack terminally — a 500 could never
        // resolve for the paid-through-another-channel case.
        logger.warn({
          message:
            'Juicyway order flip found the order already paid; recording settlement idempotently',
          orderId: transaction.order_id,
          reference,
        });
        const settled = await recordJuicywayOrderSettlement(
          createAdminClient(),
          {
            amount: transaction.amount,
            merchant_id: transaction.merchant_id,
            order_id: transaction.order_id,
            platform_fee: transaction.platform_fee,
          },
          reference
        );
        if (!settled) {
          // This branch IS the recovery path for these captured funds:
          // acking without the settlement would strand them.
          return NextResponse.json(
            { error: 'Merchant settlement unavailable' },
            { status: 500 }
          );
        }
        // Also drain serialized-inventory confirmation (idempotent): a
        // winner that crashed right after its flip never reached it.
        // Email/push cannot be safely replayed here because Juicyway has no
        // dispatch marker. The durable conversion pipeline is idempotent, so
        // it is recovered below after inventory is confirmed.
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
              'Juicyway 0-row flip failed to confirm inventory for the paid order',
            orderId: transaction.order_id,
          });
          // Redelivery re-enters this branch: settlement no-ops, inventory
          // retries.
          return NextResponse.json(
            { error: 'Inventory confirmation failed' },
            { status: 500 }
          );
        }
        if (isEventPipelineEnqueueEnabled()) {
          const { data: conversionOrderRow, error: conversionOrderError } =
            await supabase
              .from('orders')
              .select(
                'id, order_number, total, currency, customer_id, customer_name, customer_email, customer_phone, shipping_address, order_items(id, product_id, condition, name, price, quantity, variant_name), ad_tracking'
              )
              .eq('id', transaction.order_id)
              .single();
          if (conversionOrderError || !conversionOrderRow) {
            return NextResponse.json(
              { error: 'Order conversion lookup failed' },
              { status: 500 }
            );
          }
          await enqueueJuicywayOrderConversion({
            merchantId: transaction.merchant_id,
            order: {
              ...conversionOrderRow,
              occurredAt: transaction.updated_at,
              total: conversionOrderRow.total ?? transaction.amount,
            } as OrderForConversion,
            scheduleAfter: (task) => after(task),
            supabase: createAdminClient(),
          });
        }
        return NextResponse.json({ message: 'Already processed' });
      }

      const orderError = response.error;
      const order = response.data as {
        id: string;
        order_number: string;
        merchant_id: string;
        customer_id: string | null;
        total: string;
        subtotal: string;
        shipping_fee: string;
        customer_name: string;
        customer_email: string;
        customer_phone: string | null;
        shipping_address: {
          address?: string;
          city?: string;
          state?: string;
        } | null;
        currency: string;
        payment_status: string;
        shipping_status: string;
        cancelled_at: string | null;
        updated_at: string;
        ad_tracking: Record<string, unknown> | null;
        order_items: Array<{
          id: string;
          product_id: string;
          name: string;
          price: number;
          quantity: number;
          condition: string | null;
          variant_name: string | null;
        }>;
      } | null;

      if (orderError || !order) {
        orderUpdateFailed = true;
        logger.error({
          message: 'Failed to update order',
          orderId: transaction.order_id,
          error: orderError,
        });
      } else if (isOrderClampedAsCancelled(order)) {
        // The prevent_cancelled_order_reopen trigger clamped this reopen:
        // suppress all paid-order side effects (email, push, conversions,
        // settlement) and file a reconciliation row. Ack the gateway.
        const reviewFiled = await handlePaymentForCancelledOrder({
          gatewayReference: reference,
          order,
          reason:
            'Juicyway payment captured for an order cancelled before finalization',
          transactionId: transaction.id,
        });
        if (!reviewFiled) {
          return NextResponse.json(
            { error: 'Payment reconciliation review unavailable' },
            { status: 500 }
          );
        }

        return NextResponse.json({
          success: true,
          message: 'Payment recorded; order was cancelled, filed for review',
        });
      } else {
        try {
          await ensurePaidOrderInventoryConfirmed(
            supabase,
            transaction.merchant_id,
            transaction.order_id
          );
        } catch (inventoryError) {
          const inventoryErrorMessage =
            inventoryError instanceof Error
              ? inventoryError.message
              : 'Inventory confirmation failed';

          logger.error({
            message: 'Juicyway webhook failed to confirm inventory',
            orderId: transaction.order_id,
            error: inventoryError,
          });
          try {
            await fileInventoryConfirmationFailureReview({
              gatewayReference: reference,
              merchantId: transaction.merchant_id,
              metadata: {
                gateway: 'juicyway',
                inventoryError: inventoryErrorMessage,
              },
              orderId: transaction.order_id,
              reason:
                'Juicyway payment was captured but serialized inventory confirmation failed',
              transactionId: transaction.id,
            });
          } catch (reviewError) {
            logger.error({
              message:
                'Juicyway webhook failed to file inventory confirmation review',
              orderId: transaction.order_id,
              error: reviewError,
            });
          }

          return NextResponse.json({
            success: true,
            message:
              'Payment recorded; inventory confirmation failed and was filed for review',
          });
        }

        logger.info({
          message: 'Order updated successfully via Juicyway',
          orderId: transaction.order_id,
        });

        // Send order confirmation email
        try {
          // Read merchant identity/branding via the service-role client. This
          // webhook has no user session (signature-verified, cookieless), so an
          // anon read here depends on the permissive `merchants` anon grant and
          // leaks tax_identification_number / cac_rc_number on the anon path.
          // The S0-A containment revokes that anon grant, so this must not run
          // as anon. (payments/webhook and payments/verify read merchants the
          // same way.)
          const { data: merchantDetails } = await createAdminClient()
            .from('merchants')
            .select(
              'business_name, slug, support_email, email_sender_name, email, tax_identification_number, cac_rc_number'
            )
            .eq('id', transaction.merchant_id)
            .single();

          if (merchantDetails && order.customer_email) {
            const rootDomain =
              process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com';
            const merchantUrl = `https://${merchantDetails.slug}.${rootDomain}`;

            const emailItems = (order.order_items || []).map((item) => ({
              name: formatOrderItemDisplayName({
                baseName: item.name || 'Product',
                condition: item.condition,
                variantName: item.variant_name,
              }),
              quantity: item.quantity || 1,
              price: item.price || 0,
            }));

            const emailData = {
              orderNumber:
                order.order_number || order.id.slice(0, 8).toUpperCase(),
              customerName: order.customer_name,
              items: emailItems,
              subtotal: Number.parseFloat(order.subtotal || '0'),
              shippingFee: Number.parseFloat(order.shipping_fee || '0'),
              total: Number.parseFloat(order.total || '0'),
              currency: order.currency || 'NGN',
              shippingAddress: {
                address: order.shipping_address?.address || '',
                city: order.shipping_address?.city || '',
                state: order.shipping_address?.state || '',
                phone: order.customer_phone || '',
              },
              merchantName: merchantDetails.business_name,
              merchantUrl,
              merchantTin:
                merchantDetails.tax_identification_number ?? undefined,
              merchantRcNumber: merchantDetails.cac_rc_number ?? undefined,
            };

            const htmlContent = generateOrderConfirmationEmail(emailData);
            const textContent = generateOrderConfirmationText(emailData);

            // Use merchant's support_email as reply-to (so customer replies go to merchant)
            // Use merchant's email_sender_name for branding (e.g., "Ogabassey Orders")
            const replyToEmail =
              merchantDetails.support_email ||
              merchantDetails.email ||
              `support@${merchantDetails.slug}.${rootDomain}`;
            const senderName = merchantDetails.email_sender_name
              ? `${merchantDetails.email_sender_name} Orders`
              : merchantDetails.business_name
                ? `${merchantDetails.business_name} Orders`
                : undefined;

            const emailResult = await sendEmail({
              to: order.customer_email,
              toName: order.customer_name,
              subject: `Order Confirmation - #${emailData.orderNumber}`,
              htmlContent,
              textContent,
              replyTo: replyToEmail,
              emailType: 'orders',
              fromName: senderName,
              auditContext: {
                merchantId: order.merchant_id,
                orderId: order.id,
                customerId: order.customer_id,
                metadata: {
                  trigger: 'juicyway_payment_confirmation',
                },
              },
            });

            if (!emailResult.success) {
              logger.error({
                message: 'Failed to send order confirmation email',
                orderId: order.id,
                emailError: emailResult.error,
                emailErrorCode: emailResult.errorCode,
                emailErrorDetails: emailResult.errorDetails,
              });
            } else {
              logger.info({
                message: 'Order confirmation email sent (Juicyway)',
                orderId: order.id,
                messageId: emailResult.messageId,
              });
            }
          }
        } catch (emailError) {
          logger.error({
            message: 'Failed to send order confirmation email',
            error: emailError,
          });
        }

        // Notify merchant of new order and payment (non-blocking)
        const orderNum =
          order.order_number || order.id.slice(0, 8).toUpperCase();
        const total = Number.parseFloat(order.total || '0');
        const currency = order.currency || 'NGN';
        const customerName = order.customer_name || 'Customer';
        after(async () => {
          try {
            await notifyNewOrder(
              transaction.merchant_id,
              order.id,
              orderNum,
              customerName,
              total,
              currency
            );
          } catch (err) {
            logger.error({
              message: 'New order push notification failed',
              error: err,
            });
          }

          try {
            await notifyPaymentReceived(
              transaction.merchant_id,
              total,
              currency,
              orderNum,
              order.id
            );
          } catch (err) {
            logger.error({
              message: 'Payment received push notification failed',
              error: err,
            });
          }
        });

        // Send offline conversion events to ad platforms
        const durableEnqueue = isEventPipelineEnqueueEnabled();
        try {
          const conversionOrder: OrderForConversion = {
            ad_tracking: order.ad_tracking,
            currency: order.currency,
            customer_email: order.customer_email,
            customer_id: order.customer_id,
            customer_name: order.customer_name,
            customer_phone: order.customer_phone,
            id: order.id,
            occurredAt: data.date,
            order_items: order.order_items,
            order_number: order.order_number,
            total: order.total,
          };
          const conversion = triggerPurchaseConversion(
            durableEnqueue ? createAdminClient() : supabase,
            transaction.merchant_id,
            conversionOrder,
            durableEnqueue ? { deliveryMode: 'enqueue_only' } : undefined
          );

          if (durableEnqueue) {
            await conversion;
            scheduleLegacyPurchaseConversion({
              merchantId: transaction.merchant_id,
              order: conversionOrder,
              scheduleAfter: (task) => after(task),
              supabase: createAdminClient(),
            });
          } else {
            void conversion.catch((error) => {
              logger.error({
                error,
                message: 'Offline conversion tracking failed',
                orderId: order.id,
              });
            });
          }

          logger.info({
            durableEnqueue,
            message: 'Offline conversion tracking initiated (Juicyway)',
            orderId: order.id,
          });
        } catch (conversionError) {
          logger.error({
            message: 'Failed to initiate offline conversion tracking',
            error: conversionError,
          });
          if (durableEnqueue) {
            // Finish settlement bookkeeping below, then fail the webhook so
            // Juicyway retries. The completed-transaction branch above
            // replays this idempotent order-scoped enqueue on that retry.
            durableEnqueueError = conversionError;
          }
        }
      }
    }

    // Record settlement for merchant wallet tracking
    const settlementRecorded = await recordJuicywayOrderSettlement(
      createAdminClient(),
      {
        amount: transaction.amount,
        merchant_id: transaction.merchant_id,
        order_id: transaction.order_id,
        platform_fee: transaction.platform_fee,
      },
      reference
    );
    if (!settlementRecorded) {
      return NextResponse.json(
        { error: 'Merchant settlement unavailable' },
        { status: 500 }
      );
    }

    if (durableEnqueueError) {
      throw durableEnqueueError;
    }

    if (orderUpdateFailed) {
      // Settlement above is recorded (idempotent upsert) so the merchant is
      // not left uncredited, but the order is NOT paid — fail closed so the
      // sender redelivers and the redelivery heals via the wedge check at
      // the top of this handler. The old swallow-to-200 here is what made
      // this wedge class permanent.
      return NextResponse.json(
        {
          code: 'ORDER_PAYMENT_COMPLETION_FAILED',
          error: 'Order payment completion failed',
        },
        { status: 500 }
      );
    }

    logger.info({
      message: 'Juicyway payment processed successfully',
      reference,
      transactionId: transaction.id,
    });

    return NextResponse.json({
      success: true,
      message: 'Payment processed successfully',
    });
  } catch (error) {
    logger.error({ message: 'Juicyway webhook error', error });
    return NextResponse.json(
      {
        error: 'Webhook processing failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
