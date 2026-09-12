import { after, type NextRequest, NextResponse } from 'next/server';
import { getKlumpSecretKey } from '@/env';
import {
  type KlumpPaidOrder,
  notifyKlumpPaidOrder,
} from '@/lib/klump-payment-notifications';
import {
  getKlumpExpectedPaymentAmount,
  verifyKlumpWebhookTransaction,
} from '@/lib/klump-transaction-verification';
import {
  amountsMatch,
  currenciesMatch,
  getKlumpWebhookSecret,
  getMergedKlumpMetadata,
  hasKlumpIdConflict,
  type JsonRecord,
  parseKlumpWebhookPayload,
  verifyKlumpWebhookSignature,
} from '@/lib/klump-webhook';
import { logger } from '@/lib/logger';
import {
  ensurePaidOrderInventoryConfirmed,
  type OrderStatusRollbackSnapshot,
  rollbackOrderStatusAfterInventoryConfirmationFailure,
} from '@/lib/payments/ensure-paid-order-inventory-confirmed';
import { fileInventoryConfirmationFailureReview } from '@/lib/payments/file-inventory-confirmation-review';
import {
  handlePaymentForCancelledOrder,
  isOrderClampedAsCancelled,
} from '@/lib/payments/handle-payment-for-cancelled-order';
import { buildInventoryConfirmationFailurePayload } from '@/lib/payments/inventory-confirmation-response';
import { resolveOrderGiglSettlementRpc } from '@/lib/payments/resolve-order-gigl-settlement-rpc';
import { calculatePlatformFee } from '@/lib/paystack';
import { createAdminClient } from '@/lib/supabase/admin';
import { referenceSchema } from '@/schemas/payments';

interface TransactionRecord {
  amount: number | string | null;
  currency: string | null;
  gateway_reference: string | null;
  id: string;
  merchant_amount: number | string | null;
  merchant_id: string;
  metadata: JsonRecord | null;
  order_id: string | null;
  platform_fee: number | string | null;
  status: string | null;
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function webhookReachabilityResponse() {
  return NextResponse.json({
    message: 'Klump webhook endpoint reachable',
    success: true,
  });
}

function isUnsignedWebhookSetupProbe({
  rawBody,
  signature,
}: {
  rawBody: string;
  signature: string | null;
}) {
  if (signature?.trim()) {
    return false;
  }

  const trimmedBody = rawBody.trim();
  if (!trimmedBody) {
    return true;
  }

  try {
    const payload: unknown = JSON.parse(trimmedBody);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return false;
    }

    return Object.keys(payload).length === 0;
  } catch {
    return false;
  }
}

export function GET() {
  return webhookReachabilityResponse();
}

export function HEAD() {
  return new Response(null, { status: 200 });
}

type KlumpUpdatedOrder = KlumpPaidOrder & {
  cancelled_at?: string | null;
  payment_status?: string | null;
  shipping_funding_source?: 'customer_checkout' | 'merchant_wallet' | null;
  shipping_platform_retained_amount?: number | string | null;
  shipping_provider?: string | null;
  shipping_status?: string | null;
};

function updateKlumpOrder({
  orderId,
  supabase,
}: {
  orderId: string;
  supabase: ReturnType<typeof createAdminClient>;
}) {
  return supabase
    .from('orders')
    .update({
      payment_status: 'paid',
      shipping_status: 'processing',
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .neq('payment_status', 'paid')
    .select(
      'id, merchant_id, order_number, customer_name, total, currency, payment_status, shipping_status, cancelled_at, shipping_provider, shipping_funding_source, shipping_platform_retained_amount'
    )
    .maybeSingle<KlumpUpdatedOrder>();
}

function getKlumpPlatformFee(
  platformFee: number | string | null,
  grossAmount: number
) {
  const hasStoredFee =
    platformFee != null &&
    !(typeof platformFee === 'string' && platformFee.trim() === '');
  const storedFee = hasStoredFee ? Number(platformFee) : Number.NaN;

  return Number.isFinite(storedFee)
    ? storedFee
    : calculatePlatformFee(grossAmount * 100).platformFee / 100;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const secret = getKlumpWebhookSecret();
  const signature = request.headers.get('x-klump-signature');

  if (!secret) {
    logger.error({
      message: 'KLUMP_WEBHOOK_SECRET or KLUMP_SECRET_KEY is not configured',
    });
    return errorResponse('Webhook secret not configured', 500);
  }

  if (isUnsignedWebhookSetupProbe({ rawBody, signature })) {
    logger.info({ message: 'Klump webhook setup probe acknowledged' });
    return webhookReachabilityResponse();
  }

  const validSignature = verifyKlumpWebhookSignature({
    rawBody,
    secret,
    signature,
  });
  if (!validSignature) {
    logger.warn({ message: 'Invalid Klump webhook signature' });
    return errorResponse('Invalid signature', 401);
  }

  const parsedPayload = parseKlumpWebhookPayload(rawBody);
  if (!parsedPayload.success) {
    return errorResponse(parsedPayload.error, 400);
  }

  if (!parsedPayload.details) {
    logger.info({ message: 'Ignoring non-success Klump webhook event' });
    return NextResponse.json({ message: 'Event ignored' });
  }

  const { details, payload } = parsedPayload;
  if (details.isLive === false) {
    logger.warn({ message: 'Ignoring sandbox Klump success webhook event' });
    return errorResponse('Sandbox Klump webhook not accepted', 400);
  }

  const referenceResult = referenceSchema.safeParse(details.merchantReference);
  if (!referenceResult.success) {
    return errorResponse('Invalid reference', 400);
  }

  const supabase = createAdminClient();
  const { data: transaction, error: transactionError } = await supabase
    .from('transactions')
    .select(
      'id, merchant_id, order_id, amount, merchant_amount, currency, gateway_reference, status, platform_fee, metadata'
    )
    .eq('gateway', 'klump')
    .eq('gateway_reference', referenceResult.data)
    .maybeSingle<TransactionRecord>();

  if (transactionError || !transaction) {
    logger.error({
      message: 'Klump transaction not found',
      error: transactionError,
      reference: referenceResult.data,
    });
    return errorResponse('Transaction not found', 404);
  }

  const expectedPaymentAmount = getKlumpExpectedPaymentAmount(transaction);

  if (!amountsMatch(expectedPaymentAmount, details.amount)) {
    return errorResponse('Payment amount mismatch', 400);
  }

  if (!currenciesMatch(transaction.currency, details.currency)) {
    return errorResponse('Payment currency mismatch', 400);
  }

  if (hasKlumpIdConflict(transaction.metadata, details.transactionId)) {
    return errorResponse('Klump transaction id conflict', 409);
  }

  const klumpSecretKey = getKlumpSecretKey() ?? secret;
  if (!klumpSecretKey) {
    logger.error({
      message: 'Klump provider verification secret is not configured',
    });
    return errorResponse(
      'Klump provider verification secret not configured',
      500
    );
  }

  const verification = await verifyKlumpWebhookTransaction({
    details,
    reference: referenceResult.data,
    secretKey: klumpSecretKey,
    transaction,
  });

  if (!verification.success) {
    logger.error({
      error: verification.error,
      message: 'Klump transaction verification failed',
      reference: referenceResult.data,
      transactionId: details.transactionId,
    });
    return errorResponse(verification.error, verification.status);
  }

  const transactionAlreadyCompleted = transaction.status === 'completed';
  let updatedTransaction: { id: string } | null = null;
  if (!transactionAlreadyCompleted) {
    const { data, error: updateError } = await supabase
      .from('transactions')
      .update({
        gateway_response: payload,
        metadata: getMergedKlumpMetadata({
          details,
          headers: request.headers,
          metadata: transaction.metadata,
        }),
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', transaction.id)
      .neq('status', 'completed')
      .select('id')
      .maybeSingle<{ id: string }>();

    if (updateError) {
      logger.error({
        message: 'Failed to update Klump transaction',
        error: updateError,
        reference: referenceResult.data,
      });
      return errorResponse('Failed to update transaction', 500);
    }

    updatedTransaction = data;
  }

  if (!transactionAlreadyCompleted && !updatedTransaction) {
    logger.info({
      message:
        'Klump transaction was completed concurrently; continuing downstream reconciliation',
      reference: referenceResult.data,
      transactionId: details.transactionId,
    });
  }

  let order: KlumpUpdatedOrder | null = null;
  if (transaction.order_id) {
    // Snapshot the order's pre-update status so a later inventory-confirmation
    // failure can roll it back to what it actually was (e.g. 'bnpl_pending'),
    // not a hardcoded 'pending' that would stomp any other prior state.
    const { data: preUpdateOrderStatus, error: preUpdateStatusError } =
      await supabase
        .from('orders')
        .select('payment_status, shipping_status')
        .eq('id', transaction.order_id)
        .maybeSingle<OrderStatusRollbackSnapshot>();
    if (preUpdateStatusError || !preUpdateOrderStatus) {
      // Fail closed BEFORE mutating: without a trustworthy snapshot a later
      // inventory-confirmation failure could not roll the order back to its
      // real prior state. Klump retries on non-2xx.
      logger.error({
        error: preUpdateStatusError,
        message: 'Klump pre-update order status snapshot failed',
        orderId: transaction.order_id,
      });
      return errorResponse('Failed to snapshot order status', 500);
    }

    const { data: updatedOrder, error: orderError } = await updateKlumpOrder({
      orderId: transaction.order_id,
      supabase,
    });

    if (orderError) {
      logger.error({
        message: 'Failed to update Klump order',
        error: orderError,
        orderId: transaction.order_id,
      });
      return errorResponse('Failed to update order', 500);
    }

    // The prevent_cancelled_order_reopen trigger clamped this reopen: suppress
    // settlement + merchant notification and file a reconciliation row. Ack
    // Klump with a 200 so it does not retry into a loop.
    if (updatedOrder && isOrderClampedAsCancelled(updatedOrder)) {
      const reviewFiled = await handlePaymentForCancelledOrder({
        gatewayReference: referenceResult.data,
        order: updatedOrder,
        reason:
          'Klump payment captured for an order cancelled before finalization',
        transactionId: transaction.id,
      });
      if (!reviewFiled) {
        return errorResponse('Payment reconciliation review unavailable', 500);
      }

      return NextResponse.json({
        message:
          'Klump payment recorded; order was cancelled, filed for review',
        success: true,
      });
    }

    order = updatedOrder;

    if (!order) {
      const { data: existingOrder, error: existingOrderError } = await supabase
        .from('orders')
        .select(
          'id, merchant_id, order_number, customer_name, total, currency, payment_status, shipping_status, cancelled_at, shipping_provider, shipping_funding_source, shipping_platform_retained_amount'
        )
        .eq('id', transaction.order_id)
        .maybeSingle<KlumpUpdatedOrder>();

      if (existingOrderError) {
        logger.error({
          message:
            'Failed to load existing Klump order for inventory confirmation',
          error: existingOrderError,
          orderId: transaction.order_id,
        });
        return errorResponse('Failed to load order', 500);
      }

      order = existingOrder;
    }

    if (order) {
      try {
        await ensurePaidOrderInventoryConfirmed(
          supabase,
          transaction.merchant_id,
          order.id
        );
      } catch (inventoryError) {
        logger.error({
          message: 'Klump webhook failed to confirm inventory',
          orderId: order.id,
          error: inventoryError,
        });

        if (updatedOrder) {
          try {
            await rollbackOrderStatusAfterInventoryConfirmationFailure(
              supabase,
              transaction.merchant_id,
              order.id,
              {
                payment_status: preUpdateOrderStatus.payment_status,
                shipping_status: preUpdateOrderStatus.shipping_status,
              }
            );
          } catch (rollbackError) {
            await fileInventoryConfirmationFailureReview({
              gatewayReference: referenceResult.data,
              merchantId: transaction.merchant_id,
              metadata: {
                inventoryError:
                  inventoryError instanceof Error
                    ? inventoryError.message
                    : inventoryError,
                klumpTransactionId: details.transactionId,
                rollbackError:
                  rollbackError instanceof Error
                    ? rollbackError.message
                    : rollbackError,
                source: 'klump_inventory_confirmation_rollback',
              },
              orderId: order.id,
              reason:
                'Klump webhook reached paid state, but serialized inventory confirmation and status rollback both failed.',
              transactionId: transaction.id,
            });
            return errorResponse('Inventory confirmation cleanup failed', 500);
          }
        }

        const responsePayload =
          buildInventoryConfirmationFailurePayload(inventoryError);
        return NextResponse.json(responsePayload, {
          status:
            responsePayload.code === 'serialized_inventory_unavailable'
              ? 409
              : 500,
        });
      }
    }
  }

  const expectedPaymentAmountNumber = Number(expectedPaymentAmount);
  const grossAmount =
    Number.isFinite(expectedPaymentAmountNumber) &&
    expectedPaymentAmountNumber > 0
      ? expectedPaymentAmountNumber
      : details.amount;
  const platformFee = getKlumpPlatformFee(
    transaction.platform_fee,
    grossAmount
  );
  const settlement = resolveOrderGiglSettlementRpc(order);

  const { error: settlementError } = await supabase.rpc(
    settlement.settlementRpc,
    {
      p_description: 'Order payment via Klump',
      p_gateway: 'klump',
      p_gateway_fee: 0,
      p_gateway_reference: referenceResult.data,
      p_gross_amount: grossAmount,
      p_merchant_id: transaction.merchant_id,
      p_metadata: {
        klump_reference: referenceResult.data,
        klump_transaction_id: details.transactionId,
        klump_webhook_id: request.headers.get('x-klump-webhook-id'),
        ...(settlement.hasEconomicsSnapshot
          ? {
              commerce_platform_fee: platformFee,
              retained_shipping_amount: settlement.retainedShippingAmount,
            }
          : {}),
      },
      p_platform_fee: platformFee,
      p_source_id: transaction.order_id,
      p_source_type: 'order',
    }
  );

  if (settlementError) {
    logger.error({
      message: 'Failed to record Klump merchant settlement',
      error: settlementError,
      reference: referenceResult.data,
    });
    return errorResponse('Failed to record settlement', 500);
  }

  if (order) {
    after(() =>
      notifyKlumpPaidOrder({
        amount: Number(order?.total) || grossAmount,
        currency: order?.currency || transaction.currency || 'NGN',
        merchantId: transaction.merchant_id,
        order,
      })
    );
  }

  return NextResponse.json({
    message: 'Klump payment processed successfully',
    success: true,
  });
}
