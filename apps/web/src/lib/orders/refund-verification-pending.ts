import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CANCELLATION_DRAIN_FETCH_LIMIT,
  CANCELLATION_DRAIN_MAX_ATTEMPTS,
} from '@/lib/orders/drain-failed-order-cancellation-side-effects';
import { normalizePaymentGateway } from '@/lib/payments/normalize-payment-gateway';

type ProbeClient = Pick<SupabaseClient, 'from'>;

// Leg page size for the id-ordered pagination below: pages are
// walked to exhaustion, so every candidate leg is scanned no
// matter how many covered rows precede the uncovered one.
const PROBE_LEG_LIMIT = 25;
// Refund-check ceiling: linked refunds are small per order, and an
// undercount only over-triggers the cap (the safe direction).
const PROBE_REFUND_LIMIT = 50;

type ProbeLeg = {
  amount: number;
  currency: string | null;
  gateway: string;
  id: string;
  order_id: string;
};

type ProbeRefund = {
  amount: number;
  currency: string | null;
  metadata: {
    method?: string;
    payment_transaction_id?: string;
    provider_refund_status?: string;
  } | null;
  order_id: string;
};

/**
 * Whether any cancelled order has a refund step with a Paystack leg
 * that can still reach provider preflight. The cron route caps the
 * reconcile phase when this is true so the 76s preflight budget
 * survives: without the reservation a full reconcile leaves ~30s
 * and every verification defers on every backlog invocation.
 * Mirrors the drain's per-status selection (oldest-first, same
 * fetch ceiling, same attempts cap) so a Paystack step the drain
 * will select is always inside the probed slice: an unfiltered
 * limit could fill with manual orders and miss it, permitting the
 * full reconcile that starves it. Only completed, not-yet-covered
 * legs count: an in-flight (refund_pending) leg defers in the
 * executor's awaiting-provider branch and a covered leg is
 * excluded from initiation, so neither ever reaches preflight —
 * counting them would pin reconciliation at the cap indefinitely
 * while the reserved window goes unused. Small indexed reads;
 * fails closed (true) on any read error: a needlessly capped
 * reconcile self-heals on the next run, while a missed
 * reservation starves preflight under backlog indefinitely, and
 * the same failure can defer the refund on every invocation.
 */
export async function isRefundVerificationPending(
  supabase: ProbeClient
): Promise<boolean> {
  const failed = await supabase
    .from('order_cancellation_side_effects')
    .select('order_id')
    .eq('step', 'refund')
    .eq('status', 'failed')
    .lt('attempts', CANCELLATION_DRAIN_MAX_ATTEMPTS)
    .order('claimed_at', { ascending: true })
    .limit(CANCELLATION_DRAIN_FETCH_LIMIT);
  if (failed.error || !failed.data) {
    return true;
  }
  const deferred = await supabase
    .from('order_cancellation_side_effects')
    .select('order_id')
    .eq('step', 'refund')
    .eq('status', 'deferred')
    .order('claimed_at', { ascending: true })
    .limit(CANCELLATION_DRAIN_FETCH_LIMIT);
  if (deferred.error || !deferred.data) {
    return true;
  }
  const orderIds = [
    ...new Set(
      [...failed.data, ...deferred.data]
        .map((step) => step.order_id)
        .filter((id) => id !== null)
    ),
  ];
  if (orderIds.length === 0) {
    return false;
  }
  // Prefilter loosely (%paystack% catches padded legacy gateways);
  // the exact normalized match below drops impostors. Paginate to
  // exhaustion in id order: one unordered limit across every leg
  // of up to 20 orders could fill with covered legs while the
  // uncovered leg falls outside the slice, missing work the drain
  // will select.
  const legs: ProbeLeg[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = supabase
      .from('transactions')
      .select('id, amount, currency, gateway, order_id')
      .in('order_id', orderIds)
      .eq('transaction_type', 'payment')
      .eq('status', 'completed')
      .gt('amount', 0)
      .ilike('gateway', '%paystack%')
      .order('id', { ascending: true });
    const { data, error } = await (cursor === null
      ? page.limit(PROBE_LEG_LIMIT)
      : page.gt('id', cursor).limit(PROBE_LEG_LIMIT));
    if (error || !data) {
      return true;
    }
    const rows = data as ProbeLeg[];
    legs.push(...rows);
    if (rows.length < PROBE_LEG_LIMIT) {
      break;
    }
    cursor = rows[rows.length - 1]?.id ?? null;
    if (cursor === null) {
      break;
    }
  }
  const paystackLegs = legs.filter(
    (leg) => normalizePaymentGateway(leg.gateway) === 'PAYSTACK'
  );
  if (paystackLegs.length === 0) {
    return false;
  }
  const { data: refunds, error: refundsError } = await supabase
    .from('transactions')
    .select('amount, currency, metadata, order_id')
    .in('order_id', orderIds)
    .eq('transaction_type', 'refund')
    .in('status', ['completed', 'refunded'])
    .gt('amount', 0)
    .limit(PROBE_REFUND_LIMIT);
  if (refundsError || !refunds) {
    return true;
  }
  return paystackLegs.some(
    (leg) => !isLegCovered(leg, paystackLegs, refunds as ProbeRefund[])
  );
}

/** Whether two currency codes match like the coverage scan (nulls never match). */
function sameCurrency(a: string | null, b: string | null): boolean {
  return (
    typeof a === 'string' &&
    typeof b === 'string' &&
    a.toUpperCase().trim() === b.toUpperCase().trim()
  );
}

/** Whether completed refunds already cover the leg, mirroring the coverage scan. */
function isLegCovered(
  leg: ProbeLeg,
  paystackLegs: ProbeLeg[],
  refunds: ProbeRefund[]
): boolean {
  // An unverified Paystack attestation proves nothing: like the
  // coverage scan, only method-gated rows count toward coverage.
  const covering = (row: ProbeRefund): number =>
    Number(row.amount) > 0 &&
    sameCurrency(row.currency, leg.currency) &&
    (row.metadata?.method !== 'paystack' ||
      row.metadata?.provider_refund_status === 'processed')
      ? Number(row.amount)
      : 0;
  let covered = 0;
  for (const row of refunds) {
    // Scope linked rows to the leg's own order like the unlinked
    // branch below: the batch spans every candidate order, so a
    // malformed refund from another order naming this leg's id
    // must not count as coverage (the worker scopes its ledger
    // read per order and would still require preflight).
    if (
      row.order_id === leg.order_id &&
      row.metadata?.payment_transaction_id === leg.id
    ) {
      covered += covering(row);
    }
  }
  // Legacy refunds carry no payment link: attribute them to the
  // sole Paystack leg of their own order, like the scan attributes
  // to the sole external leg (narrowed to Paystack; multi-gateway
  // legacy shapes over-trigger, the safe direction). Never across
  // orders: one candidate's unlinked refund must not cover another
  // candidate's leg.
  const orderLegs = paystackLegs.filter(
    (candidate) => candidate.order_id === leg.order_id
  );
  if (orderLegs.length === 1) {
    for (const row of refunds) {
      if (
        row.order_id === leg.order_id &&
        (row.metadata === null ||
          row.metadata?.payment_transaction_id === undefined)
      ) {
        covered += covering(row);
      }
    }
  }
  return covered >= Number(leg.amount);
}
