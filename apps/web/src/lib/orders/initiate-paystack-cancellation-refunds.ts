import type { SupabaseClient } from '@supabase/supabase-js';
import { initiateRefund as initiatePaystackRefund } from '@/lib/initiate-paystack-refund';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';
import {
  DeferredError,
  DeliveryUncertainError,
} from '@/lib/orders/run-order-cancellation-side-effect';

/**
 * Initiate a Paystack refund for every gateway leg that has no recorded
 * completed refund, auditing each accepted refund before moving on. Returns
 * the accepted provider refund IDs. Throws on the first leg that cannot
 * proceed; quarantine paths file a reconciliation review first.
 */
export async function initiatePaystackCancellationRefunds({
  deadlineMs,
  isLastAttempt,
  order,
  reason,
  refundedPaymentIds,
  supabase,
  transactions,
}: {
  deadlineMs?: number;
  /**
   * Set when this run consumes the final retry attempt: a rate-limited
   * leg must file durable evidence instead of throwing retryable, since
   * the drain never reselects attempts-capped rows.
   */
  isLastAttempt?: boolean;
  order: {
    currency: string | null;
    id: string;
    merchant_id: string;
    order_number: string | null;
  };
  reason?: string;
  refundedPaymentIds: Set<string>;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
  transactions: GatewayPaymentTransaction[];
}): Promise<number[]> {
  const refundIds: number[] = [];

  for (const transaction of transactions) {
    if (refundedPaymentIds.has(transaction.id)) continue;
    // Bound every leg to the remaining invocation deadline: a plain
    // Error keeps the step retryable, so unattempted legs run on the
    // next tick instead of stranding a mid-flight claim.
    const timeoutMs =
      deadlineMs === undefined ? undefined : deadlineMs - Date.now();
    if (timeoutMs !== undefined && timeoutMs <= 0) {
      throw new Error('cancellation_refund_deadline_exceeded');
    }
    const transactionAmount = Number(transaction.amount);
    const paystackRefund = await initiatePaystackRefund(
      transaction.gateway_reference as string,
      Math.round(transactionAmount * 100),
      reason || 'Order cancelled',
      timeoutMs
    );
    if (!paystackRefund.success) {
      const isAmbiguousFailure =
        paystackRefund.code === 'NETWORK_ERROR' ||
        paystackRefund.code?.startsWith('HTTP_5');
      // A rate-limited leg was definitely rejected: nothing was accepted,
      // so quarantining terminally would strand the remaining legs after
      // the accepted ones settle. Throw retryable instead — the drain
      // defers while accepted legs are in flight, then resumes here with
      // settled legs skipped. Ambiguous and deterministic failures still
      // quarantine below: the provider may have accepted, or never will.
      const isDefiniteTransientFailure = paystackRefund.code === 'HTTP_429';
      // Rate-limited legs stay review-free while retries remain — but the
      // drain never reselects attempts-capped rows, so a 429 on the last
      // attempt must file durable evidence instead of stranding the leg
      // while cron reports success.
      const isExhaustedTransientFailure =
        isDefiniteTransientFailure && isLastAttempt === true;
      if (refundIds.length > 0 && !isDefiniteTransientFailure) {
        await quarantineRefund({
          metadata: {
            accepted_refund_ids: refundIds,
            failed_payment_transaction_id: transaction.id,
            // An ambiguous later failure may still have created a provider
            // refund: mark it so the completion gate never auto-closes the
            // review on other legs' evidence.
            ...(isAmbiguousFailure ? { ambiguous_initiation: true } : {}),
          },
          order,
          reason:
            'Some payment legs were accepted for refund, but a later leg failed',
          supabase,
          transactions: [transaction],
        });
      } else if (!isDefiniteTransientFailure) {
        // No accepted legs yet and the provider will not take this leg on
        // retry: an ambiguous failure may still have created a provider
        // refund no reconciler could discover, while a deterministic
        // rejection (bad reference, invalid amount) would only burn the
        // five-attempt budget and strand the customer unrefunded without
        // a review. File the leg for operations either way.
        await quarantineRefund({
          metadata: {
            failed_payment_transaction_id: transaction.id,
            ...(isAmbiguousFailure ? { ambiguous_initiation: true } : {}),
          },
          order,
          reason: isAmbiguousFailure
            ? 'Paystack refund initiation failed ambiguously and may already exist for this payment leg'
            : 'Paystack refund initiation was rejected for this payment leg',
          supabase,
          transactions: [transaction],
        });
      } else if (isExhaustedTransientFailure) {
        try {
          await quarantineRefund({
            metadata: {
              ...(refundIds.length > 0
                ? { accepted_refund_ids: refundIds }
                : {}),
              failed_payment_transaction_id: transaction.id,
              rate_limit_exhausted: true,
            },
            order,
            // The provider rejected every attempt, so a replacement
            // refund can still proceed: no ambiguous-initiation marker,
            // letting the completion gate auto-close this review on
            // coverage. Preflight stays set even with accepted legs —
            // they are audited before any later leg runs, so a deferred
            // retry observes them via the awaiting-provider check
            // instead of re-initiating.
            preflight: true,
            reason:
              refundIds.length > 0
                ? 'Some payment legs were accepted for refund, but a later leg was rate limited on every retry'
                : 'Paystack refund initiation was rate limited on every retry for this payment leg',
            supabase,
            transactions: [transaction],
          });
        } catch (error) {
          if (error instanceof DeliveryUncertainError) throw error;
          // The review write or merge failed on the last attempt: a
          // plain retryable error would strand the leg without evidence
          // since the budget is spent, so defer instead — deferred rows
          // reselect without the attempts cap until the review lands.
          throw new DeferredError(
            error instanceof Error ? error.message : String(error)
          );
        }
      }
      const RefundError = isAmbiguousFailure ? DeliveryUncertainError : Error;
      throw new RefundError(paystackRefund.error);
    }

    const providerStatus = String(paystackRefund.data.status ?? '')
      .trim()
      .toLowerCase();
    const providerTransaction = paystackRefund.data.transaction;
    const providerPaymentId =
      typeof providerTransaction === 'number'
        ? providerTransaction
        : providerTransaction?.id;
    if (
      !Number.isSafeInteger(paystackRefund.data.id) ||
      paystackRefund.data.id <= 0 ||
      !Number.isSafeInteger(providerPaymentId) ||
      providerPaymentId <= 0 ||
      (typeof providerTransaction !== 'number' &&
        providerTransaction?.reference !== transaction.gateway_reference)
    ) {
      if (
        Number.isSafeInteger(paystackRefund.data.id) &&
        paystackRefund.data.id > 0
      ) {
        const { error: uncertainInsertError } = await supabase
          .from('transactions')
          .insert({
            merchant_id: order.merchant_id,
            order_id: order.id,
            transaction_type: 'refund',
            amount: transactionAmount,
            currency: transaction.currency || order.currency || 'NGN',
            status: 'refund_pending',
            gateway: 'paystack',
            gateway_reference: String(paystackRefund.data.id),
            description: `Refund for cancelled order #${order.order_number || order.id.slice(0, 8)}`,
            metadata: {
              cancellation_reason: reason ?? null,
              payment_transaction_id: transaction.id,
              provider_payment_transaction_id:
                Number.isSafeInteger(providerPaymentId) && providerPaymentId > 0
                  ? providerPaymentId
                  : null,
              provider_refund_status: providerStatus,
              // Deliberately unheld: if the quarantine review below fails
              // transiently, the polling reconciler must still discover
              // this row, re-verify it, and file the review itself.
            },
          });
        if (uncertainInsertError) {
          await quarantineRefund({
            metadata: {
              provider_refund_id: paystackRefund.data.id,
              payment_transaction_id: transaction.id,
              audit_record_failed: true,
            },
            order,
            reason:
              'Paystack accepted refund but its uncertain audit row could not be recorded',
            supabase,
            transactions: [transaction],
          });
        }
      }
      // quarantineRefund throws DeliveryUncertainError. The surrounding
      // runOrderCancellationSideEffect persists delivery_uncertain, and its
      // claim RPC refuses a second provider call until manual reconciliation.
      await quarantineRefund({
        metadata: {
          provider_refund_id: paystackRefund.data.id,
          payment_transaction_id: transaction.id,
        },
        order,
        reason: 'Paystack accepted refund without matching payment evidence',
        supabase,
        transactions: [transaction],
      });
    }
    const { error: insertTxError } = await supabase
      .from('transactions')
      .insert({
        merchant_id: order.merchant_id,
        order_id: order.id,
        transaction_type: 'refund',
        amount: transactionAmount,
        currency: transaction.currency || order.currency || 'NGN',
        // Fetch Refund independently verifies even an immediate processed reply.
        status: 'refund_pending',
        gateway: transaction.gateway,
        gateway_reference: String(paystackRefund.data.id),
        description: `Refund for cancelled order #${order.order_number || order.id.slice(0, 8)}`,
        metadata: {
          cancellation_reason: reason ?? null,
          payment_transaction_id: transaction.id,
          provider_payment_transaction_id: providerPaymentId,
          provider_refund_status: providerStatus,
        },
      });
    if (insertTxError) {
      let recordedByAnotherWriter = false;
      if (insertTxError.code === '23505') {
        // A concurrent webhook recovery may have recorded this refund —
        // but the unique index spans all transaction types and gateways,
        // so a collision alone proves nothing. Only treat the refund as
        // recorded after verifying the winning row is this provider
        // refund.
        const { data: conflicting, error: conflictLookupError } = await supabase
          .from('transactions')
          .select('id, transaction_type, gateway, gateway_reference')
          .eq('order_id', order.id)
          .eq('gateway_reference', String(paystackRefund.data.id))
          .maybeSingle();
        recordedByAnotherWriter =
          !conflictLookupError &&
          conflicting?.transaction_type === 'refund' &&
          conflicting?.gateway === 'paystack' &&
          conflicting?.gateway_reference === String(paystackRefund.data.id);
      }
      if (!recordedByAnotherWriter) {
        // The provider accepted this refund but no local row exists, so the
        // webhook and polling reconcilers cannot discover it. Persist the
        // provider ID in the review before quarantining.
        await quarantineRefund({
          metadata: {
            provider_refund_id: paystackRefund.data.id,
            payment_transaction_id: transaction.id,
            audit_record_failed: true,
          },
          order,
          reason: 'Paystack accepted refund but its local audit record failed',
          supabase,
          transactions: [transaction],
        });
      }
    }
    refundIds.push(paystackRefund.data.id);
  }
  return refundIds;
}
