import { type NextRequest, NextResponse } from 'next/server';
import { getCronSecret } from '@/env';
import { constantTimeEqual } from '@/lib/constant-time-equal';
import { notifyMerchant } from '@/lib/expo-push';
import { logger } from '@/lib/logger';
import { fileStuckCreditDirectReviews } from '@/lib/payments/file-stuck-credit-direct-review';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStuckBnplSignals } from './get-stuck-bnpl-signals';
import { loadBnplTransactionEvidence } from './load-bnpl-transaction-evidence';
import {
  buildStuckBnplAlert,
  type StuckBnplOrderRow,
} from './stuck-bnpl-alert';
import { STUCK_BNPL_CONFIG } from './stuck-bnpl-config';

// pending/unpaid only prove the customer PICKED a BNPL method at checkout;
// require provider-session evidence (a persisted transaction/session
// reference in notes) so plain abandoned carts — which cleanup-orders
// reclassifies at 72h — don't page merchants at 24h.
// Credit Direct bnpl_pending is deliberately retained for the existing ops
// recovery queue even if legacy notes were lost. This is not proof of provider
// contact and never qualifies an order for a merchant push by itself.
const STATUSES_REQUIRING_PROVIDER_EVIDENCE = new Set(['pending', 'unpaid']);

// Alerts merchants and queues Credit Direct orders missing provider confirmation.
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = getCronSecret();

    if (
      !authHeader ||
      !cronSecret ||
      !constantTimeEqual(authHeader, `Bearer ${cronSecret}`)
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    const minAgeCutoff = new Date(
      now.getTime() - STUCK_BNPL_CONFIG.minAgeHours * 3_600_000
    ).toISOString();
    const maxAgeCutoff = new Date(
      now.getTime() - STUCK_BNPL_CONFIG.maxAgeDays * 86_400_000
    ).toISOString();

    // Age on updated_at, not created_at: resumed/reminder orders flip into a
    // BNPL state long after creation (set_credit_direct_session does not
    // touch created_at), and a genuinely stuck order has no row movement.
    const supabase = createAdminClient();
    const { data: stuckOrders, error } = await supabase
      .from('orders')
      .select(
        'id, order_number, merchant_id, total, payment_method, payment_status, updated_at, notes'
      )
      .in('payment_status', STUCK_BNPL_CONFIG.paymentStatuses)
      .in('payment_method', STUCK_BNPL_CONFIG.paymentMethods)
      .lt('updated_at', minAgeCutoff)
      .or(`payment_status.eq.bnpl_approved,updated_at.gte.${maxAgeCutoff}`)
      .order('updated_at', { ascending: true })
      .limit(STUCK_BNPL_CONFIG.orderScanLimit);

    if (error) {
      logger.error({
        message: 'Failed to scan for stuck BNPL orders',
        error,
      });
      return NextResponse.json(
        { error: 'Failed to scan orders' },
        { status: 500 }
      );
    }

    const scannedOrders = (stuckOrders ?? []) as StuckBnplOrderRow[];
    if (scannedOrders.length === STUCK_BNPL_CONFIG.orderScanLimit) {
      logger.warn({
        message: 'Stuck-BNPL scan hit scan limit; report may be partial',
        scanLimit: STUCK_BNPL_CONFIG.orderScanLimit,
      });
    }
    // Some BNPL flows (e.g. CredPal via /api/payments/initialize) never write
    // a reference into notes but do create a transactions row — check that as
    // a second evidence source before dropping pending/unpaid orders. Only
    // rows that progressed beyond 'pending' count: initialize creates its
    // pending transaction row before the customer even opens the provider
    // popup, so treating those as evidence would re-admit plain abandoned
    // carts.
    const signalsByOrderId = new Map(
      scannedOrders.map((order) => [order.id, getStuckBnplSignals(order)])
    );
    const evidenceCandidates = scannedOrders.filter((order) => {
      const signals = signalsByOrderId.get(order.id);
      const requiresEvidence =
        STATUSES_REQUIRING_PROVIDER_EVIDENCE.has(order.payment_status || '') ||
        (order.payment_status === 'bnpl_pending' &&
          signals?.provider !== 'credit_direct');
      return requiresEvidence && !signals?.hasCheckoutEvidence;
    });
    const ordersWithoutCheckoutEvidence = new Set(
      evidenceCandidates.map((order) => order.id)
    );
    const {
      progressedOrderIds: orderIdsWithTransactionEvidence,
      referencesByOrderId: transactionEvidenceReferences,
      lookupFailed: transactionEvidenceLookupFailed,
    } = await loadBnplTransactionEvidence(supabase, signalsByOrderId);

    const orders = scannedOrders.filter(
      (order) =>
        !ordersWithoutCheckoutEvidence.has(order.id) ||
        orderIdsWithTransactionEvidence.has(order.id)
    );

    const reviewFailures = await fileStuckCreditDirectReviews(
      supabase,
      orders.filter(
        (order) => signalsByOrderId.get(order.id)?.provider === 'credit_direct'
      ),
      transactionEvidenceReferences
    );

    // CredPal never progresses its transactions row past 'pending' and its
    // launcher flow writes no notes reference, so a stuck CredPal order is
    // indistinguishable from an abandoned cart. Surface the dropped set to
    // ops logs instead of paging merchants with unavoidable false positives.
    // Recovering that indistinguishable set requires authoritative CredPal
    // status reconciliation, a separate provider integration; do not manufacture
    // confirmation from pending rows in this notification scan.
    const weakEvidenceDropped = evidenceCandidates.filter(
      (order) => !orderIdsWithTransactionEvidence.has(order.id)
    );
    if (!transactionEvidenceLookupFailed && weakEvidenceDropped.length > 0) {
      logger.warn({
        message:
          'Stuck-BNPL scan dropped pending/unpaid BNPL orders without provider evidence (possible stuck CredPal)',
        droppedCount: weakEvidenceDropped.length,
        orderIds: weakEvidenceDropped.slice(0, 10).map((order) => order.id),
      });
    }

    // Page merchants only for orders that show the customer got through the
    // provider. Session-only Credit Direct orders stay in the ops review
    // queue above but are overwhelmingly abandoned applications.
    const alertOrders = orders.filter(
      (order) =>
        signalsByOrderId.get(order.id)?.shouldAlert ||
        orderIdsWithTransactionEvidence.has(order.id)
    );
    const sessionOnlyOrders = orders.length - alertOrders.length;
    if (sessionOnlyOrders > 0) {
      logger.info({
        message:
          'Stuck-BNPL scan left session-only orders out of the merchant alert (no approval or completion signal)',
        sessionOnlyOrders,
      });
    }

    if (alertOrders.length === 0) {
      return NextResponse.json({
        success: true,
        stuckOrders: 0,
        alertOrders: 0,
        reviewOnlyOrders: sessionOnlyOrders,
        merchants: 0,
        merchantsNotified: 0,
        ...(reviewFailures.length > 0 && { reviewFailures }),
      });
    }

    const ordersByMerchant = new Map<string, StuckBnplOrderRow[]>();
    for (const order of alertOrders) {
      const merchantOrders = ordersByMerchant.get(order.merchant_id);
      if (merchantOrders) {
        merchantOrders.push(order);
      } else {
        ordersByMerchant.set(order.merchant_id, [order]);
      }
    }

    let merchantsNotified = 0;
    const pushFailures: string[] = [];

    const merchantEntries = Array.from(ordersByMerchant.entries());
    for (
      let index = 0;
      index < merchantEntries.length;
      index += STUCK_BNPL_CONFIG.notificationConcurrency
    ) {
      const batchResults = await Promise.all(
        merchantEntries
          .slice(index, index + STUCK_BNPL_CONFIG.notificationConcurrency)
          .map(async ([merchantId, merchantOrders]) => {
            const alert = buildStuckBnplAlert(merchantOrders, now);

            logger.warn({
              message: 'BNPL orders stuck awaiting provider confirmation',
              merchantId,
              stuckOrderCount: alert.orderCount,
              totalAmount: alert.totalAmount,
              oldestOrderId: alert.oldest.id,
              oldestOrderNumber: alert.oldest.order_number,
              oldestAgeDays: alert.oldestAgeDays,
            });

            try {
              const result = await notifyMerchant(
                merchantId,
                alert.title,
                alert.body,
                alert.data,
                'orders'
              );

              return {
                merchantId,
                notified: result.sent > 0,
              };
            } catch (pushError) {
              logger.error({
                message: 'Failed to push stuck-BNPL alert',
                merchantId,
                error: pushError,
              });
              return {
                merchantId,
                notified: false,
              };
            }
          })
      );

      for (const result of batchResults) {
        if (result.notified) {
          merchantsNotified++;
        } else {
          pushFailures.push(result.merchantId);
        }
      }
    }

    return NextResponse.json({
      success: true,
      stuckOrders: alertOrders.length,
      alertOrders: alertOrders.length,
      reviewOnlyOrders: sessionOnlyOrders,
      merchants: ordersByMerchant.size,
      merchantsNotified,
      ...(reviewFailures.length > 0 && { reviewFailures }),
      ...(pushFailures.length > 0 && { pushFailures }),
    });
  } catch (error) {
    logger.error({
      message: 'Unexpected error in stuck-BNPL alert cron',
      error,
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
