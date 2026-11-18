import { formatCurrency } from '@/lib/expo-push';

export interface StuckBnplOrderRow {
  id: string;
  order_number: string | null;
  merchant_id: string;
  total: number | string | null;
  payment_method: string | null;
  payment_status: string | null;
  updated_at: string;
  notes: string | null;
}

const PROVIDER_LABELS: Record<string, string> = {
  credit_direct: 'Credit Direct',
  credpal: 'CredPal',
  klump: 'Klump',
};

export function hasProviderTransactionReference(notes: string | null) {
  return Boolean(notes && /transactionid/i.test(notes));
}

function hasClientCompletionMarker(notes: string | null) {
  return Boolean(notes && /creditdirectclientcompletedat/i.test(notes));
}

export function hasProviderCheckoutEvidence(notes: string | null) {
  return (
    hasProviderTransactionReference(notes) || hasClientCompletionMarker(notes)
  );
}

// A session/transaction reference only proves the customer OPENED the
// provider's application. In production ~99% of those are abandoned and are
// cancelled by cleanup-orders at 72h, so they must not page the merchant.
// These are the signals that the customer actually got through the provider:
// the provider approved the loan, or the checkout reported completion.
// (A progressed transactions row is the third signal; the route checks it.)
export function hasConfirmationSignal(order: StuckBnplOrderRow) {
  return (
    order.payment_status === 'bnpl_approved' ||
    hasClientCompletionMarker(order.notes)
  );
}

// Only Credit Direct reports checkout completion, so only its session-only
// orders can be told apart from real unconfirmed payments. Klump and CredPal
// have no such marker: muting them would hide a lost webhook entirely, so
// they keep paging on the scan's provider-evidence rule.
export function shouldAlertMerchant(
  order: StuckBnplOrderRow,
  hasProgressedTransaction: boolean
) {
  return (
    hasConfirmationSignal(order) ||
    hasProgressedTransaction ||
    order.payment_method !== 'credit_direct'
  );
}

export function getStuckAgeDays(lastMovementAt: string, now: Date) {
  const lastMovement = new Date(lastMovementAt).getTime();
  if (!Number.isFinite(lastMovement)) return 0;
  return Math.max(0, Math.floor((now.getTime() - lastMovement) / 86_400_000));
}

function describeAge(days: number) {
  if (days <= 1) return 'over a day';
  return `${days} days`;
}

function describeProvider(orders: StuckBnplOrderRow[]) {
  const methods = new Set(orders.map((order) => order.payment_method));
  const [onlyMethod] = methods;
  return methods.size === 1 && onlyMethod && PROVIDER_LABELS[onlyMethod]
    ? PROVIDER_LABELS[onlyMethod]
    : 'the BNPL provider';
}

function orderLabel(order: StuckBnplOrderRow) {
  return `#${order.order_number || order.id.slice(0, 8)}`;
}

/** Builds the merchant push for orders that completed BNPL checkout unpaid. */
export function buildStuckBnplAlert(
  merchantOrders: StuckBnplOrderRow[],
  now: Date
) {
  if (merchantOrders.length === 0) {
    throw new Error('buildStuckBnplAlert needs at least one order');
  }
  const totalAmount = merchantOrders.reduce(
    (sum, order) => sum + (Number(order.total) || 0),
    0
  );
  const oldest = merchantOrders.reduce((earliest, order) =>
    Date.parse(order.updated_at) < Date.parse(earliest.updated_at)
      ? order
      : earliest
  );
  const oldestAgeDays = getStuckAgeDays(oldest.updated_at, now);
  const orderCount = merchantOrders.length;
  const provider = describeProvider(merchantOrders);
  const single = orderCount === 1;

  const title = single
    ? '⚠️ BNPL payment to confirm'
    : `⚠️ ${orderCount} BNPL payments to confirm`;
  const body = single
    ? `Order ${orderLabel(oldest)} (${formatCurrency(totalAmount)}) went through ${provider} checkout ${describeAge(oldestAgeDays)} ago, but the payment is not confirmed yet. Check with ${provider} before you fulfil it.`
    : `${orderCount} orders totalling ${formatCurrency(totalAmount)} went through ${provider} checkout, but the payments are not confirmed yet. Oldest: ${orderLabel(oldest)} (${describeAge(oldestAgeDays)}). Check with ${provider} before you fulfil them.`;

  return {
    title,
    body,
    oldest,
    oldestAgeDays,
    orderCount,
    totalAmount,
    data: {
      type: 'stuck_bnpl_alert',
      stuck_order_count: orderCount,
      total_amount: totalAmount,
      oldest_order_id: oldest.id,
      // One order: tapping the push opens it. Several: the app opens the
      // orders list instead.
      ...(single ? { order_id: oldest.id } : {}),
    },
  };
}
