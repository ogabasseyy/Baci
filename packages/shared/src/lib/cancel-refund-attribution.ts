/**
 * Pure mirror of the cancellation worker's refund attribution gates
 * (apps/web classifyCancellationRefundLinks + matchCancellationRefundCoverage
 * + the quarantine conditions in preflightCancellationRefundCoverage). The
 * plan calls this so that every condition under which the worker quarantines
 * an order for unattributable refund evidence also stops the clients from
 * saying what is owed. A parity test in apps/web runs shared fixtures through
 * both implementations so they cannot drift.
 */
export interface AttributionRow {
  amount: number;
  currency?: string | null;
  gateway: string | null;
  id?: string;
  payment_transaction_id?: string | null;
  provider_refund_id?: string | number | null;
  provider_refund_status?: string | null;
  /** Manual refund rows: the method the merchant declared (metadata). */
  refund_method?: string | null;
  status: string;
  transaction_type?: string;
}

const FUNDED = new Set(['completed', 'refund_pending', 'refunded']);
const TERMINAL = new Set(['completed', 'refunded']);
const INTERNAL = new Set([
  'WALLET',
  'SAVINGS',
  'STORE_CREDIT',
  'CASH',
  'MANUAL',
  'PAY_ON_DELIVERY',
]);

const norm = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toUpperCase();
const kobo = (value: number): number => Math.round(Number(value) * 100);
const isExternal = (gateway: string | null): boolean => {
  const normalized = norm(gateway);
  return normalized === '' || !INTERNAL.has(normalized);
};

/**
 * True when the worker would quarantine the order for refund evidence it
 * cannot attribute or reconcile (so the plan cannot say what is owed).
 * `orderCurrency` blank defaults to NGN like the worker's preflight gate.
 */
export function hasUnresolvedRefundEvidence(
  rows: readonly AttributionRow[],
  orderCurrency: string | null | undefined
): boolean {
  const fundedLegs = rows.filter(
    (row) => row.transaction_type === 'payment' && FUNDED.has(row.status)
  );
  const fundedIds = new Set(fundedLegs.map((leg) => leg.id));
  const allLegs = fundedLegs.filter((leg) => leg.status !== 'refunded');
  const legById = new Map(allLegs.map((leg) => [leg.id, leg]));
  const completedExternal = allLegs.filter(
    (leg) =>
      isExternal(leg.gateway) &&
      leg.status === 'completed' &&
      Number(leg.amount) > 0
  );
  const soleLeg = completedExternal.length === 1 ? completedExternal[0] : null;
  const orderCcy = norm(orderCurrency) || 'NGN';

  const matched = new Map<string, number>();
  const completedLinked = new Set<string>();
  const manualLinked = new Set<string>();
  const unverified = new Set<string>();
  let unlinkedCount = 0;
  let unattributedUnlinked = 0;
  let unresolved = false;

  for (const row of rows.filter((r) => r.transaction_type === 'refund')) {
    const claimed = row.payment_transaction_id || null;
    // A claimed link outside this order's funded legs is stale or foreign.
    if (claimed !== null && !fundedIds.has(claimed)) {
      unresolved = true;
      continue;
    }
    const linkedId = claimed;
    if (linkedId === null) unlinkedCount += 1;
    const attributed = linkedId === null && soleLeg !== null;
    const paymentId = linkedId ?? (attributed ? (soleLeg?.id ?? null) : null);
    if (!TERMINAL.has(row.status) || paymentId === null) {
      if (linkedId === null) unattributedUnlinked += 1;
      continue;
    }
    const leg = paymentId ? legById.get(paymentId) : undefined;
    if (!leg) {
      if (attributed) unattributedUnlinked += 1;
      continue;
    }
    if (norm(row.currency) !== orderCcy) unresolved = true;
    const rowGateway = norm(row.gateway);
    const isManual = rowGateway === 'MANUAL';
    const currencyMatches = norm(row.currency) === norm(leg.currency);
    if (isManual && linkedId !== null) {
      manualLinked.add(paymentId);
      if (!currencyMatches) {
        unresolved = true;
        continue;
      }
      if (
        row.refund_method === 'paystack' &&
        row.provider_refund_status !== 'processed'
      ) {
        unresolved = true;
        continue;
      }
    } else if (isManual) {
      unattributedUnlinked += 1;
      continue;
    } else {
      completedLinked.add(paymentId);
    }
    const gatewayMatches =
      rowGateway !== '' && rowGateway === norm(leg.gateway);
    if ((!gatewayMatches && !isManual) || !currencyMatches) {
      unresolved = true;
      if (attributed) unattributedUnlinked += 1;
      continue;
    }
    if (
      rowGateway === 'PAYSTACK' &&
      row.provider_refund_status !== 'processed'
    ) {
      unverified.add(paymentId);
      continue;
    }
    const rowKobo = kobo(row.amount);
    if (!Number.isSafeInteger(rowKobo) || rowKobo <= 0) {
      if (attributed) unattributedUnlinked += 1;
      continue;
    }
    matched.set(paymentId, (matched.get(paymentId) ?? 0) + rowKobo);
  }

  // Non-manual terminal evidence short of full coverage mismatches the leg.
  for (const leg of allLegs) {
    const covered = (matched.get(leg.id ?? '') ?? 0) >= kobo(leg.amount);
    if (
      leg.id &&
      completedLinked.has(leg.id) &&
      !manualLinked.has(leg.id) &&
      !covered &&
      !unverified.has(leg.id)
    ) {
      unresolved = true;
    }
  }
  const soleCovered =
    soleLeg !== null &&
    !!soleLeg.id &&
    ((matched.get(soleLeg.id) ?? 0) >= kobo(soleLeg.amount) ||
      unverified.has(soleLeg.id));
  return (
    unresolved ||
    unattributedUnlinked > 0 ||
    (unlinkedCount > 0 && !soleCovered)
  );
}
