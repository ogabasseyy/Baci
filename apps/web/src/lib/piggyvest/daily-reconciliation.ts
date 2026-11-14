import { piggyvestDailyReconciliationSchemas as schemas } from '@/schemas/piggyvest-daily-reconciliation';
import type { CreditGapReport } from './credit-gap-reconciliation';
import {
  confirmShortfalls,
  readBalance,
  unreadableBalance,
} from './daily-reconciliation-balances';

/**
 * The daily reconciliation. It only reads: our recorded transfers and
 * balances (the snapshot port) against PiggyVest's own transfer status and
 * wallet balances. It never resubmits, settles, releases or otherwise moves
 * anything; a stuck transfer is reported with the status PiggyVest gives
 * (the status query, never a blind retry) and a person resolves it.
 *
 * What pages (status `attention`): any transfer still reserved or dispatched
 * past the cutoff; a goal wallet holding LESS at PiggyVest than the principal
 * we confirmed into it; a balance that could not be read; a list cut short.
 * A shortfall is re-read once before it counts. A wallet holding MORE is
 * normal while interest accrues, so a small surplus is listed for review
 * (`above_expected`) and NEVER pages, however large: the recorded figure is
 * principal only, so interest would page forever. A snapshot that cannot be
 * loaded or parsed is `failed`: never reported as clean.
 */
export type TransferReading =
  | 'submitted'
  | 'pending'
  | 'failed'
  | 'not_found'
  | 'uncertain'
  | 'not_dispatched';

export type BalanceKind =
  | 'match'
  | 'below_expected'
  | 'above_expected'
  | 'unreadable';

export type AttentionReason =
  | 'stuck_transfers'
  | 'balance_below_expected'
  | 'balance_unreadable'
  | 'list_truncated'
  | 'read_deadline_reached'
  | 'credit_gap';

export interface StuckFinding {
  operationId: string;
  reference: string;
  state: 'reserved' | 'dispatched';
  amountKobo: number;
  ageSeconds: number;
  reading: TransferReading;
}

export interface BalanceFinding {
  walletId: string;
  expectedKobo: number;
  providerKobo: number | null;
  differenceKobo: number | null;
  kind: BalanceKind;
}

export type ReconciliationReport =
  | {
      status: 'failed';
      reason:
        | 'not_configured'
        | 'run_failed'
        | 'snapshot_unavailable'
        | 'snapshot_invalid';
      generatedAt: string;
    }
  | {
      status: 'clean' | 'attention';
      generatedAt: string;
      staleAfterSeconds: number;
      stuckTotal: number;
      stuck: StuckFinding[];
      walletsTotal: number;
      balances: BalanceFinding[];
      /**
       * A list holds one rotating window, not every row. Stuck rows left out
       * page (`list_truncated`); wallets left out do not, because the window
       * moves each day so every wallet is checked across runs.
       */
      truncated: { stuck: boolean; wallets: boolean };
      /** How many rows each list left out of this run's window. */
      deferred: { stuck: number; wallets: number };
      /** Set when provider reads were cut off to leave time to report. */
      deadlineReached?: true;
      /** PVB credits vs our credit ledgers (credit-gap-reconciliation.ts). */
      creditGap?: CreditGapReport;
      reasons: AttentionReason[];
    };

export interface ReconciliationPorts {
  loadSnapshot: () => Promise<unknown>;
  /** The provider's status for one dispatched transfer (status query). */
  readTransfer: (
    transfer: ReturnType<typeof schemas.stuckTransfer.parse>,
    businessId: string
  ) => Promise<Exclude<TransferReading, 'not_dispatched'>>;
  /** The provider's balance for a wallet, in kobo. */
  readWalletBalance: (walletId: string) => Promise<number>;
  /** Used only to stamp a failed report, which has no database time. */
  now: () => string;
  /**
   * Optional read budget. Once `nowMs()` reaches `deadlineMs`, no new provider
   * read starts: unstarted transfer lookups read as uncertain and unstarted
   * balances as unreadable, so the report (and page) still goes out in time.
   */
  nowMs?: () => number;
  deadlineMs?: number;
}

const MAX_CONCURRENT_READS = 5;

interface Budget {
  expired: () => boolean;
  hit: boolean;
}

function budgetOf(ports: ReconciliationPorts): Budget {
  const { nowMs, deadlineMs } = ports;
  const budget: Budget = {
    hit: false,
    expired: () => {
      if (nowMs && deadlineMs !== undefined && nowMs() >= deadlineMs)
        budget.hit = true;
      return budget.hit;
    },
  };
  return budget;
}

/**
 * Runs `run` in small batches. Once the budget is spent a batch is not
 * started; its items get `skipped` instead, so no read is left in flight past
 * the deadline except the batch already running.
 */
async function mapLimited<T, R>(
  items: readonly T[],
  budget: Budget,
  run: (item: T) => Promise<R>,
  skipped: (item: T) => R
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += MAX_CONCURRENT_READS) {
    const batch = items.slice(start, start + MAX_CONCURRENT_READS);
    if (budget.expired()) {
      results.push(...batch.map(skipped));
      continue;
    }
    results.push(...(await Promise.all(batch.map(run))));
  }
  return results;
}

function stuckFinding(
  transfer: ReturnType<typeof schemas.stuckTransfer.parse>,
  reading: TransferReading
): StuckFinding {
  return {
    operationId: transfer.operationId,
    reference: transfer.reference,
    state: transfer.state,
    amountKobo: transfer.amountKobo,
    ageSeconds: transfer.ageSeconds,
    reading,
  };
}

async function readStuck(
  ports: ReconciliationPorts,
  businessId: string,
  transfer: ReturnType<typeof schemas.stuckTransfer.parse>
): Promise<StuckFinding> {
  let reading: TransferReading = 'not_dispatched';
  if (transfer.state === 'dispatched') {
    try {
      reading = await ports.readTransfer(transfer, businessId);
    } catch {
      // A failed lookup is never "absent": the transfer may have moved money.
      reading = 'uncertain';
    }
  }
  return stuckFinding(transfer, reading);
}

export async function runDailyReconciliation(
  ports: ReconciliationPorts
): Promise<ReconciliationReport> {
  let loaded: unknown;
  try {
    loaded = await ports.loadSnapshot();
  } catch {
    return {
      status: 'failed',
      reason: 'snapshot_unavailable',
      generatedAt: ports.now(),
    };
  }
  const parsed = schemas.snapshot.safeParse(loaded);
  if (!parsed.success)
    return {
      status: 'failed',
      reason: 'snapshot_invalid',
      generatedAt: ports.now(),
    };
  const snapshot = parsed.data;
  const budget = budgetOf(ports);
  const stuck = await mapLimited(
    snapshot.stuck,
    budget,
    (transfer) => readStuck(ports, snapshot.businessId, transfer),
    (transfer) =>
      stuckFinding(
        transfer,
        transfer.state === 'reserved' ? 'not_dispatched' : 'uncertain'
      )
  );
  const firstBalances = await mapLimited(
    snapshot.wallets,
    budget,
    (wallet) => readBalance(ports, wallet),
    unreadableBalance
  );
  const balances = await confirmShortfalls(
    ports,
    firstBalances,
    snapshot.wallets,
    () => !budget.expired()
  );
  const deferred = {
    stuck: snapshot.stuckDeferred,
    wallets: snapshot.walletsDeferred,
  };
  const truncated = {
    stuck: deferred.stuck > 0,
    wallets: deferred.wallets > 0,
  };
  const reasons: AttentionReason[] = [];
  if (snapshot.stuckTotal > 0 || stuck.length > 0)
    reasons.push('stuck_transfers');
  if (balances.some((balance) => balance.kind === 'below_expected'))
    reasons.push('balance_below_expected');
  if (balances.some((balance) => balance.kind === 'unreadable'))
    reasons.push('balance_unreadable');
  if (truncated.stuck) reasons.push('list_truncated');
  if (budget.hit) reasons.push('read_deadline_reached');
  return {
    status: reasons.length > 0 ? 'attention' : 'clean',
    generatedAt: snapshot.generatedAt,
    staleAfterSeconds: snapshot.staleAfterSeconds,
    stuckTotal: snapshot.stuckTotal,
    stuck,
    walletsTotal: snapshot.walletsTotal,
    balances,
    truncated,
    deferred,
    ...(budget.hit ? { deadlineReached: true as const } : {}),
    reasons,
  };
}
