import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import {
  CANCELLATION_DRAIN_FETCH_LIMIT,
  CANCELLATION_DRAIN_MAX_ATTEMPTS,
} from '@/lib/orders/drain-failed-order-cancellation-side-effects';
import { normalizePaymentGateway } from '@/lib/payments/normalize-payment-gateway';

// Fail closed with an ops signal: without the warn a persistent probe
// outage would silently pin every cron run to the capped phase.
function failClosed(reason: string): true {
  logger.warn({
    message: 'Refund verification probe failed closed; reconcile capped',
    reason,
  });
  return true;
}

type ProbeClient = Pick<SupabaseClient, 'from'>;

// Overall probe budget inside the cron invocation: the probe runs
// before any deadline is computed, so a slow (not erroring) probe
// would otherwise eat the 5-minute invocation and every drain
// behind it computes a zero limit. Ten seconds of the 60s
// reconcile phase; expiry fails closed (capped), the safe
// direction the probe already uses for read errors.
export const REFUND_VERIFICATION_PROBE_BUDGET_MS = 10_000;

// Leg page size for the id-ordered pagination below: pages are
// walked to exhaustion, so every candidate leg is scanned no
// matter how many covered rows precede the uncovered one.
const PROBE_LEG_LIMIT = 25;
// Page ceiling for that walk: the probe runs before the cron
// deadline is computed, so an unbounded walk could consume the
// invocation budget the reconcile cap is meant to protect. Past
// 200 legs the probe stops and reports pending (the safe
// direction: over-triggering only caps reconcile).
const PROBE_MAX_LEG_PAGES = 8;
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
  gateway: unknown;
  metadata: {
    method?: string;
    payment_transaction_id?: string;
    provider_refund_status?: string;
  } | null;
  order_id: string;
};

/**
 * Attach an abort signal to a query builder when one is given.
 * postgrest cancels the in-flight request on abort, so a probe that
 * loses its deadline race stops consuming Postgres instead of
 * running orphaned to completion. Returns the builder for chaining.
 */
function abortable<T>(query: T, signal?: AbortSignal): T {
  if (signal) {
    (
      query as unknown as { abortSignal: (signal: AbortSignal) => unknown }
    ).abortSignal(signal);
  }
  return query;
}

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
  supabase: ProbeClient,
  options?: { signal?: AbortSignal }
): Promise<boolean> {
  const failed = await abortable(
    supabase
      .from('order_cancellation_side_effects')
      .select('order_id')
      .eq('step', 'refund')
      .eq('status', 'failed')
      .lt('attempts', CANCELLATION_DRAIN_MAX_ATTEMPTS)
      .order('claimed_at', { ascending: true }),
    options?.signal
  ).limit(CANCELLATION_DRAIN_FETCH_LIMIT);
  if (failed.error || !failed.data) {
    return failClosed('side_effects_failed_read');
  }
  const deferred = await abortable(
    supabase
      .from('order_cancellation_side_effects')
      .select('order_id')
      .eq('step', 'refund')
      .eq('status', 'deferred')
      .order('claimed_at', { ascending: true }),
    options?.signal
  ).limit(CANCELLATION_DRAIN_FETCH_LIMIT);
  if (deferred.error || !deferred.data) {
    return failClosed('side_effects_deferred_read');
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
  for (let pages = 0; ; pages += 1) {
    const page = abortable(
      supabase
        .from('transactions')
        .select('id, amount, currency, gateway, order_id')
        .in('order_id', orderIds)
        .eq('transaction_type', 'payment')
        .eq('status', 'completed')
        .gt('amount', 0)
        .ilike('gateway', '%paystack%')
        .order('id', { ascending: true }),
      options?.signal
    );
    const { data, error } = await (cursor === null
      ? page.limit(PROBE_LEG_LIMIT)
      : page.gt('id', cursor).limit(PROBE_LEG_LIMIT));
    if (error || !data) {
      return failClosed('transactions_leg_read');
    }
    const rows = data as ProbeLeg[];
    legs.push(...rows);
    if (rows.length < PROBE_LEG_LIMIT) {
      break;
    }
    if (pages + 1 >= PROBE_MAX_LEG_PAGES) {
      return failClosed('leg_page_ceiling');
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
  const { data: refunds, error: refundsError } = await abortable(
    supabase
      .from('transactions')
      .select('amount, currency, gateway, metadata, order_id')
      .in('order_id', orderIds)
      .eq('transaction_type', 'refund')
      .in('status', ['completed', 'refunded'])
      .gt('amount', 0),
    options?.signal
  ).limit(PROBE_REFUND_LIMIT);
  if (refundsError || !refunds) {
    return failClosed('transactions_refund_read');
  }
  return paystackLegs.some(
    (leg) => !isLegCovered(leg, paystackLegs, refunds as ProbeRefund[])
  );
}

/**
 * Probe with an overall deadline: resolves the probe result, or
 * true when the deadline passes first (expired budget fails closed
 * like a read error). The losing probe is aborted, not merely
 * abandoned, so a degraded probe degrades to the capped phase
 * instead of consuming the invocation and leaving orphaned reads
 * running against Postgres.
 */
export async function isRefundVerificationPendingBefore(
  supabase: ProbeClient,
  deadlineMs: number
): Promise<boolean> {
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) {
    return failClosed('probe_budget_exhausted');
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      isRefundVerificationPending(supabase, {
        signal: controller.signal,
      }).catch(() => failClosed('probe_threw')),
      new Promise<true>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(failClosed('probe_deadline'));
        }, remainingMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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
  // Unverified Paystack-substance rows (stored gateway OR method
  // claim — native rows carry identity in the gateway column,
  // stamped manuals via method) prove nothing: either signal
  // alone demands a processed verdict, like the coverage scan.
  const covering = (row: ProbeRefund): number =>
    Number(row.amount) > 0 &&
    sameCurrency(row.currency, leg.currency) &&
    ((normalizePaymentGateway(row.gateway) !== 'PAYSTACK' &&
      row.metadata?.method !== 'paystack') ||
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
