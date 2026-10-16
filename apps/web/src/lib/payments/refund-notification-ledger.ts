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
 * counting Paystack rows only after provider verification. Each leg
 * contributes at most its own amount (mirroring the capped per-leg
 * helper): an overfunded leg must not inflate the notified total.
 * Merchant-declared Paystack rows count only after provider
 * verification, mirroring the claim gate's positive rule. Refund-state
 * legs (e.g. PayPal flips the payment row itself to refund_pending
 * while its provider refund is pending) still need their linked
 * refund; only self-terminal refunded legs carry their own evidence.
 * Unlinked legacy refunds match when the order holds exactly one
 * completed external payment leg. Manual-only internal legs (cash,
 * store credit, and kin — never wallet/savings, which reverse through
 * their own ledgers) validate through explicitly linked manual rows in
 * matching money, mirroring the aggregate claim, and join the total;
 * without them a cash-only finalization would dead-letter its own
 * notification. Reversal-only orders (wallet/savings legs alone)
 * total from the reversal queries below: the manager counts those
 * reversals as refunded coverage, so the ledger must admit them or
 * every notification dead-letters. Throws refund_notification_ledger_*
 * on mismatch.
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
    const legKobo = Math.round(Number(leg.amount) * 100);
    const matchedKobo = refunds
      .filter((refund) => {
        const refundGateway = normalizePaymentGateway(refund.gateway);
        const metadata = refund.metadata as {
          method?: unknown;
          payment_transaction_id?: unknown;
          provider_refund_status?: unknown;
        } | null;
        // Merchant-attested manual rows link explicitly and count as
        // coverage in matching money, mirroring the aggregate claim;
        // they never sole-attribute, so an unlinked manual row still
        // mismatches for review. A manual row declaring the Paystack
        // method counts only after provider verification, mirroring
        // the claim gate's positive rule.
        if (refundGateway === 'MANUAL') {
          if (
            metadata?.method === 'paystack' &&
            metadata?.provider_refund_status !== 'processed'
          )
            return false;
          return (
            metadata?.payment_transaction_id === leg.id &&
            normalizeCurrencyCode(refund.currency) === legCurrency &&
            Number(refund.amount) > 0
          );
        }
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
    if (matchedKobo < legKobo) return undefined;
    return {
      amount: Math.min(matchedKobo, legKobo) / 100,
      currency: leg.currency,
    };
  });
  // Manual-only legs validate exactly like the claim's internal
  // coverage: explicitly linked manual rows in matching money summing
  // to the leg, capped at the leg, with the claim's Paystack
  // method/provider gate. Self-terminal refunded legs carry their own
  // evidence.
  const linkedManualRefunds = manualLegs.map((leg) => {
    if (leg.status === 'refunded') {
      return { amount: leg.amount, currency: leg.currency };
    }
    const legCurrency = normalizeCurrencyCode(leg.currency);
    const legKobo = Math.round(Number(leg.amount) * 100);
    const matchedKobo = refunds
      .filter((refund) => {
        const metadata = refund.metadata as {
          method?: unknown;
          payment_transaction_id?: unknown;
          provider_refund_status?: unknown;
        } | null;
        if (
          metadata?.method === 'paystack' &&
          metadata?.provider_refund_status !== 'processed'
        )
          return false;
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
    if (matchedKobo < legKobo) return undefined;
    return {
      amount: Math.min(matchedKobo, legKobo) / 100,
      currency: leg.currency,
    };
  });
  const linkedTotals = [...linkedRefunds, ...linkedManualRefunds];
  // Internal reversals return outside the refund ledger — wallet
  // reversals credit customer_wallets, savings reversals restore the
  // goal — but the refund manager counts both as refunded coverage,
  // so the notification total must too or mixed orders understate
  // (a ₦50 cash leg plus a ₦50 wallet reversal would read ₦50 of
  // ₦100 returned). Mirror the manager's predicates verbatim: the
  // wallet source_type and the savings reversed_at key. Read before
  // the mismatch gate: a reversal-only order has no external or
  // manual legs, and gating first would dead-letter a notification
  // the finalizer queued for real reversed money.
  const { data: walletRows, error: walletError } = await supabase
    .from('customer_wallet_transactions')
    .select('amount')
    .eq('source_id', order.id)
    .eq('merchant_id', merchantId)
    .eq('source_type', 'order_reversal');
  if (walletError) throw new Error('refund_notification_ledger_lookup_failed');
  const { data: savingsRows, error: savingsError } = await supabase
    .from('customer_savings_redemptions')
    .select('amount, metadata')
    .eq('order_id', order.id)
    .eq('merchant_id', merchantId);
  if (savingsError) throw new Error('refund_notification_ledger_lookup_failed');
  const reversalAmount =
    (walletRows ?? []).reduce(
      (sum: number, row: { amount: number }) => sum + Number(row.amount),
      0
    ) +
    (savingsRows ?? [])
      .filter(
        (row: { metadata: unknown }) =>
          row.metadata !== null &&
          typeof row.metadata === 'object' &&
          'reversed_at' in row.metadata
      )
      .reduce(
        (sum: number, row: { amount: number }) => sum + Number(row.amount),
        0
      );
  const hasLedgerLegs = externalLegs.length > 0 || manualLegs.length > 0;
  if (!hasLedgerLegs || linkedTotals.some((refund) => refund === undefined)) {
    // Legless orders total from reversals alone; anything else
    // without legs is unaccounted money, not a notification.
    if (!hasLedgerLegs && reversalAmount > 0) {
      return formatAmount(
        reversalAmount,
        normalizeCurrencyCode(order.currency) || 'NGN'
      );
    }
    throw new Error('refund_notification_ledger_mismatch');
  }
  const refundAmount = (linkedTotals as Array<{ amount: number }>).reduce(
    (sum, leg) => sum + Number(leg.amount),
    0
  );
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
  return formatAmount(refundAmount + reversalAmount, orderCurrency);
}
