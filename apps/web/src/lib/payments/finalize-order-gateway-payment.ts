import { logger } from '@/lib/logger';
import { confirmPaidOrderInventoryOrRollback } from '@/lib/payments/confirm-paid-order-inventory';
import { fileBlockedOrderPaymentReview } from '@/lib/payments/file-blocked-order-payment-review';
import type {
  FinalizeOrderGatewayPaymentArgs,
  FinalizeOrderGatewayPaymentOutcome,
} from './finalize-order-gateway-payment-types';

export type {
  FinalizeOrderGatewayPaymentOutcome,
  FinalizeOrderGatewayPaymentTransaction,
} from './finalize-order-gateway-payment-types';

import { fileSettlementCaptureFailureReview } from '@/lib/payments/file-settlement-capture-failure-review';
import { schedulePaidOrderNotifications } from '@/lib/payments/notify-paid-order';
import { getOrderOutboxState } from '@/lib/payments/order-has-outbox-rows';
import { toRichPaidOrder } from '@/lib/payments/paid-order-normalization';
import { persistPaidOrderSideEffectRetry } from '@/lib/payments/paid-order-retry-persistence';
import { PAID_ORDER_RICH_SELECT } from '@/lib/payments/paid-order-rich-select';
import { persistPrePushRetryMarkers } from '@/lib/payments/persist-pre-push-retry-markers';
import { resolveOrderGatewayCompletion } from '@/lib/payments/resolve-order-gateway-completion';
import { runPaidOrderSideEffects } from '@/lib/payments/run-paid-order-side-effects';
import { settleCapturedOrderPayment } from '@/lib/payments/settle-captured-order-payment';

export async function finalizeOrderGatewayPayment({
  supabase,
  transaction,
  orderId,
  gateway,
  reference,
  gatewayResponse,
  wonTransactionFlip,
  actor,
  scheduleAfter,
}: FinalizeOrderGatewayPaymentArgs): Promise<FinalizeOrderGatewayPaymentOutcome> {
  const result = await resolveOrderGatewayCompletion({
    actor,
    gateway,
    gatewayResponse,
    merchantId: transaction.merchant_id,
    orderId,
    reference,
    supabase,
    transactionId: transaction.id,
  });
  if (!result.ok) return result.outcome;
  const completion = result.completion;

  const blockedOutcome = await fileBlockedOrderPaymentReview({
    completion,
    gateway,
    orderId,
    reference,
    transactionGatewayReference: transaction.gateway_reference,
    transactionId: transaction.id,
  });
  if (blockedOutcome) {
    return blockedOutcome;
  }

  const healed = Boolean(
    completion.already_completed && completion.order_updated
  );
  const outboxState = completion.order_updated
    ? null
    : await getOrderOutboxState(supabase, orderId);
  if (
    completion.order_already_paid &&
    !completion.order_updated &&
    outboxState?.lookupFailed
  ) {
    return {
      error: new Error('payment_side_effects_lookup_failed'),
      kind: 'completion_failed',
    };
  }
  const capturedOnAlreadyPaidOrder =
    Boolean(completion.order_already_paid) &&
    !completion.order_updated &&
    ((!result.redvaultDuplicate && wonTransactionFlip) ||
      (Boolean(outboxState?.hasRows) &&
        outboxState?.payerTransactionId !== transaction.id));
  const legacyPaidReplay =
    Boolean(completion.order_already_paid) &&
    !completion.order_updated &&
    !wonTransactionFlip &&
    outboxState?.hasRows === false;

  const shouldNotify =
    Boolean(completion.order_updated) ||
    (!capturedOnAlreadyPaidOrder && Boolean(outboxState?.onlyUntouchedSeed));

  const { data: order, error: orderFetchError } = await supabase
    .from('orders')
    .select(PAID_ORDER_RICH_SELECT)
    .eq('id', orderId)
    .single();

  if (orderFetchError || !order) {
    // Order IS paid, side effects have not run: persist pre-push markers so
    // the cron drain finds it even after redeliveries are exhausted (the
    // wedge sweep only scans NOT-paid orders).
    if (capturedOnAlreadyPaidOrder) {
      await fileSettlementCaptureFailureReview({
        error: orderFetchError,
        gateway,
        orderId,
        reference: transaction.gateway_reference ?? reference,
        transactionId: transaction.id,
      });
    } else if (wonTransactionFlip || completion.order_updated) {
      await persistPrePushRetryMarkers({
        error: orderFetchError,
        logMessage: 'Paid order fetch failed after atomic completion',
        orderId,
        reference,
        supabase,
        transactionId: transaction.id,
      });
    }
    return { error: orderFetchError, kind: 'order_fetch_failed' };
  }

  let richOrder: ReturnType<typeof toRichPaidOrder>;
  try {
    richOrder = toRichPaidOrder(order, {
      merchantId: transaction.merchant_id,
    });
  } catch (normalizationError) {
    // Same recovery contract as a failed fetch.
    if (capturedOnAlreadyPaidOrder) {
      await fileSettlementCaptureFailureReview({
        error: normalizationError,
        gateway,
        orderId,
        reference: transaction.gateway_reference ?? reference,
        transactionId: transaction.id,
      });
    } else if (wonTransactionFlip || completion.order_updated) {
      await persistPrePushRetryMarkers({
        error: normalizationError,
        logMessage: 'Paid order payload failed normalization after completion',
        orderId,
        reference,
        supabase,
        transactionId: transaction.id,
      });
    }
    return { error: normalizationError, kind: 'order_fetch_failed' };
  }

  if (!capturedOnAlreadyPaidOrder && !result.redvaultInventoryConfirmed) {
    const inventoryOutcome = await confirmPaidOrderInventoryOrRollback({
      gateway,
      merchantId: transaction.merchant_id,
      orderId,
      orderWasUpdatedByThisCall: Boolean(completion.order_updated),
      previousPaymentStatus: completion.previous_payment_status,
      previousShippingStatus: completion.previous_shipping_status,
      reference,
      supabase,
      transactionGatewayReference: transaction.gateway_reference,
      transactionId: transaction.id,
    });
    if (inventoryOutcome.kind !== 'confirmed') {
      return inventoryOutcome;
    }
  }

  // Pre-outbox completions may still owe serialized inventory confirmation,
  // but their email and settlement ran inline. Confirm inventory, then stop
  // before the modern side-effect drain to avoid duplicating those effects.
  if (legacyPaidReplay) {
    return {
      healed,
      kind: 'completed',
      orderNumber: completion.order_number ?? null,
    };
  }

  if (shouldNotify) {
    schedulePaidOrderNotifications({
      merchantId: transaction.merchant_id,
      richOrder,
      scheduleAfter,
    });
  }

  if (
    !capturedOnAlreadyPaidOrder &&
    !shouldNotify &&
    outboxState?.onlyFreshPrePushEvidence
  ) {
    logger.info({
      message: 'Deferring side-effect drain while pre-push evidence is fresh',
      orderId,
      reference,
    });
    return {
      healed,
      kind: 'completed',
      orderNumber: completion.order_number ?? null,
    };
  }

  const sideEffectArgs = {
    actor,
    externalGatewayReference: reference,
    gatewayResponse,
    order: richOrder,
    scheduleAfter,
    settlementGateway: gateway,
    supabase,
    transaction: {
      amount: transaction.amount,
      gateway_reference: transaction.gateway_reference ?? null,
      id: transaction.id,
      merchant_id: transaction.merchant_id,
      order_id: richOrder.id,
      platform_fee: transaction.platform_fee,
    },
  };

  try {
    if (capturedOnAlreadyPaidOrder) {
      await settleCapturedOrderPayment(sideEffectArgs);
      logger.info({
        message: 'Settled a gateway capture on an order already paid elsewhere',
        orderId: richOrder.id,
        reference,
      });
      return {
        healed,
        kind: 'completed',
        orderNumber: completion.order_number ?? null,
      };
    }

    const sideEffectsResult = await runPaidOrderSideEffects(sideEffectArgs);
    logger.info({
      concurrentTakeoverSteps: sideEffectsResult.concurrentTakeoverSteps,
      failedSteps: sideEffectsResult.failedSteps,
      message: 'payment_side_effects executed',
      orderId: richOrder.id,
      ranSteps: sideEffectsResult.ranSteps,
      reference,
      skippedSteps: sideEffectsResult.skippedSteps,
    });
  } catch (sideEffectError) {
    if (capturedOnAlreadyPaidOrder) {
      await fileSettlementCaptureFailureReview({
        error: sideEffectError,
        gateway,
        orderId: richOrder.id,
        reference: transaction.gateway_reference ?? reference,
        transactionId: transaction.id,
      });
      logger.error({
        error: sideEffectError,
        message: 'Settlement-only capture failed and was filed for review',
        orderId: richOrder.id,
        reference,
        transactionId: transaction.id,
      });
      return { error: sideEffectError, kind: 'completion_failed' };
    }

    await persistPaidOrderSideEffectRetry({
      error: sideEffectError,
      orderId: richOrder.id,
      reference,
      supabase,
      transaction: { id: transaction.id },
    });
    logger.error({
      error:
        sideEffectError instanceof Error
          ? { message: sideEffectError.message, stack: sideEffectError.stack }
          : sideEffectError,
      message: 'Paid order side effects failed after payment completion',
      orderId: richOrder.id,
      reference,
      transactionId: transaction.id,
    });
  }

  return {
    healed,
    kind: 'completed',
    orderNumber: completion.order_number ?? null,
  };
}
