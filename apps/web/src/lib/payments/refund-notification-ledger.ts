import type { SupabaseClient } from '@supabase/supabase-js';
import { isExternalPaymentGateway } from '@/lib/orders/is-external-payment-gateway';
import { normalizeCurrencyCode } from './normalize-currency-code';
import { normalizePaymentGateway } from './normalize-payment-gateway';

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
  }).format(amount);
}

const MANUAL_COVERAGE_INTERNAL_GATEWAYS = new Set([
  'STORE_CREDIT',
  'CASH',
  'MANUAL',
  'PAY_ON_DELIVERY',
]);

/**
 * Total the refunded amount for a cancelled order's notification, mirroring
 * the completion RPC: every funded external payment leg sums its linked
 * same-gateway, same-currency completed refunds to at least its amount,
 * counting Paystack rows only after provider verification.
 * Refund-state legs (e.g. PayPal flips the payment row itself to
 * refund_pending while its provider refund is pending) still need their
 * linked refund; only self-terminal refunded legs carry their own
 * evidence. Unlinked legacy refunds match when the order holds exactly
 * one completed external payment leg. Manual-only internal legs (cash,
 * store credit, and kin — never wallet/savings, which reverse through
 * their own ledgers) validate through explicitly linked manual rows in
 * matching money, mirroring the aggregate claim, and join the total;
 * without them a cash-only finalization would dead-letter its own
 * notification. Throws refund_notification_ledger_* on mismatch.
 */
export async function refundNotificationLedgerAmount({
  merchantId,
  order,
  supabase,
}: {
  merchantId: string;
  order: { currency: string | null; id: string };
  supabase: Pick<SupabaseClient, 'from'>;
}): Promise<string> {
  const { data: paymentLegs, error: paymentLegError } = await supabase
    .from('transactions')
    .select('id, gateway, amount, currency, status')
    .eq('order_id', order.id)
    .eq('merchant_id', merchantId)
    .eq('transaction_type', 'payment')
    .in('status', ['completed', 'refund_pending', 'refunded']);
  if (paymentLegError || !paymentLegs?.length) {
    throw new Error('refund_notification_ledger_lookup_failed');
  }
  const externalLegs = paymentLegs.filter(
    (leg) => Number(leg.amount) > 0 && isExternalPaymentGateway(leg.gateway)
  );
  // Manual-allocatable internal legs, mirroring the claim guard's set:
  // cash-like money the merchant returns by hand. Wallet and savings
  // reverse through their own ledgers and never carry manual coverage.
  const manualLegs = paymentLegs.filter(
    (leg) =>
      Number(leg.amount) > 0 &&
      MANUAL_COVERAGE_INTERNAL_GATEWAYS.has(
        normalizePaymentGateway(leg.gateway)
      )
  );
  // Terminal evidence is completed or refunded (legacy
  // provider-confirmed rows), mirroring the aggregate claim: the claim
  // finalizes on refunded rows, so the ledger must count them or the
  // queued notifications dead-letter.
  const { data: refundLegs, error: refundLegError } = await supabase
    .from('transactions')
    .select('amount, currency, gateway, metadata')
    .eq('order_id', order.id)
    .eq('merchant_id', merchantId)
    .eq('transaction_type', 'refund')
    .in('status', ['completed', 'refunded']);
  if (refundLegError) {
    throw new Error('refund_notification_ledger_lookup_failed');
  }
  // Self-terminal legs (e.g. a PayPal-only cancellation flips the
  // payment row itself to refunded) carry their own evidence without a
  // separate refund transaction: an empty refund-row set is valid when
  // every covered leg is self-terminal.
  if (
    !refundLegs?.length &&
    [...externalLegs, ...manualLegs].some((leg) => leg.status !== 'refunded')
  ) {
    throw new Error('refund_notification_ledger_lookup_failed');
  }
  const refunds = refundLegs ?? [];
  // Unlinked legacy refunds mirror the completion RPC: they match only
  // the order's sole COMPLETED external payment. A refund_pending leg
  // must validate through its explicit link — counting it here would
  // reject a legacy row the RPC already accepted and dead-letter a
  // notification for a successfully finalized order.
  const completedLegs = externalLegs.filter(
    (leg) => leg.status === 'completed'
  );
  const linkedRefunds = externalLegs.map((leg) => {
    if (leg.status === 'refunded') {
      return { amount: leg.amount, currency: leg.currency };
    }
    const legCurrency = normalizeCurrencyCode(leg.currency);
    const legGateway = normalizePaymentGateway(leg.gateway);
    const matchedKobo = refunds
      .filter((refund) => {
        const refundGateway = normalizePaymentGateway(refund.gateway);
        const metadata = refund.metadata as {
          payment_transaction_id?: unknown;
          provider_refund_status?: unknown;
        } | null;
        // Merchant-attested manual rows link explicitly and count as
        // coverage in matching money, mirroring the aggregate claim;
        // they never sole-attribute, so an unlinked manual row still
        // mismatches for review.
        if (refundGateway === 'MANUAL')
          return (
            metadata?.payment_transaction_id === leg.id &&
            normalizeCurrencyCode(refund.currency) === legCurrency &&
            Number(refund.amount) > 0
          );
        if (refundGateway === '' || refundGateway !== legGateway) return false;
        // A locally completed Paystack refund counts only after it is
        // provider-verified; other gateways keep local-status trust.
        if (
          refundGateway === 'PAYSTACK' &&
          metadata?.provider_refund_status !== 'processed'
        )
          return false;
        if (
          normalizeCurrencyCode(refund.currency) !== legCurrency ||
          !(Number(refund.amount) > 0)
        )
          return false;
        const link = metadata?.payment_transaction_id;
        return (
          link === leg.id ||
          (link == null &&
            leg.status === 'completed' &&
            completedLegs.length === 1)
        );
      })
      .reduce(
        (sum, refund) => sum + Math.round(Number(refund.amount) * 100),
        0
      );
    if (matchedKobo < Math.round(Number(leg.amount) * 100)) return undefined;
    return { amount: matchedKobo / 100, currency: leg.currency };
  });
  // Manual-only legs validate exactly like the claim's internal
  // coverage: explicitly linked manual rows in matching money summing
  // to the leg. Self-terminal refunded legs carry their own evidence.
  const linkedManualRefunds = manualLegs.map((leg) => {
    if (leg.status === 'refunded') {
      return { amount: leg.amount, currency: leg.currency };
    }
    const legCurrency = normalizeCurrencyCode(leg.currency);
    const matchedKobo = refunds
      .filter((refund) => {
        const metadata = refund.metadata as {
          payment_transaction_id?: unknown;
        } | null;
        return (
          normalizePaymentGateway(refund.gateway) === 'MANUAL' &&
          metadata?.payment_transaction_id === leg.id &&
          normalizeCurrencyCode(refund.currency) === legCurrency &&
          Number(refund.amount) > 0
        );
      })
      .reduce(
        (sum, refund) => sum + Math.round(Number(refund.amount) * 100),
        0
      );
    if (matchedKobo < Math.round(Number(leg.amount) * 100)) return undefined;
    return { amount: matchedKobo / 100, currency: leg.currency };
  });
  const linkedTotals = [...linkedRefunds, ...linkedManualRefunds];
  if (
    (externalLegs.length === 0 && manualLegs.length === 0) ||
    linkedTotals.some((refund) => refund === undefined)
  ) {
    throw new Error('refund_notification_ledger_mismatch');
  }
  const refundAmount = (
    linkedTotals as Array<{ amount: number }>
  ).reduce((sum, leg) => sum + Number(leg.amount), 0);
  // Normalize the order currency once: a legacy padded code must
  // compare equal AND format — Intl.NumberFormat throws on ' NGN '.
  const orderCurrency = normalizeCurrencyCode(order.currency) || 'NGN';
  if (
    refundAmount <= 0 ||
    linkedTotals.some(
      (leg) =>
        normalizeCurrencyCode((leg as { currency: string }).currency) !==
        orderCurrency
    )
  ) {
    throw new Error('refund_notification_ledger_mismatch');
  }
  return formatAmount(refundAmount, orderCurrency);
}
