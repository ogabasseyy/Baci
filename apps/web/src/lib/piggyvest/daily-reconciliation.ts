import { piggyvestDailyReconciliationSchemas as schemas } from '@/schemas/piggyvest-daily-reconciliation';

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
 * A wallet holding MORE is normal while interest accrues, so it is listed
 * for review (`above_expected`) but does not page. A snapshot that cannot be
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
  | 'list_truncated';

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
      reason: 'not_configured' | 'snapshot_unavailable' | 'snapshot_invalid';
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
      truncated: { stuck: boolean; wallets: boolean };
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
}

const MAX_CONCURRENT_READS = 5;

async function mapLimited<T, R>(
  items: readonly T[],
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += MAX_CONCURRENT_READS)
    results.push(
      ...(await Promise.all(
        items.slice(start, start + MAX_CONCURRENT_READS).map(run)
      ))
    );
  return results;
}

async function readBalance(
  ports: ReconciliationPorts,
  wallet: { walletId: string; expectedKobo: number }
): Promise<BalanceFinding> {
  let providerKobo: unknown;
  try {
    providerKobo = await ports.readWalletBalance(wallet.walletId);
  } catch {
    providerKobo = undefined;
  }
  if (
    typeof providerKobo !== 'number' ||
    !Number.isSafeInteger(providerKobo) ||
    providerKobo < 0
  )
    return {
      walletId: wallet.walletId,
      expectedKobo: wallet.expectedKobo,
      providerKobo: null,
      differenceKobo: null,
      kind: 'unreadable',
    };
  const differenceKobo = providerKobo - wallet.expectedKobo;
  let kind: BalanceKind = 'match';
  if (differenceKobo < 0) kind = 'below_expected';
  else if (differenceKobo > 0) kind = 'above_expected';
  return {
    walletId: wallet.walletId,
    expectedKobo: wallet.expectedKobo,
    providerKobo,
    differenceKobo,
    kind,
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
  return {
    operationId: transfer.operationId,
    reference: transfer.reference,
    state: transfer.state,
    amountKobo: transfer.amountKobo,
    ageSeconds: transfer.ageSeconds,
    reading,
  };
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
  const stuck = await mapLimited(snapshot.stuck, (transfer) =>
    readStuck(ports, snapshot.businessId, transfer)
  );
  const balances = await mapLimited(snapshot.wallets, (wallet) =>
    readBalance(ports, wallet)
  );
  const truncated = {
    stuck: snapshot.stuckTotal > snapshot.stuck.length,
    wallets: snapshot.walletsTotal > snapshot.wallets.length,
  };
  const reasons: AttentionReason[] = [];
  if (snapshot.stuckTotal > 0 || stuck.length > 0)
    reasons.push('stuck_transfers');
  if (balances.some((balance) => balance.kind === 'below_expected'))
    reasons.push('balance_below_expected');
  if (balances.some((balance) => balance.kind === 'unreadable'))
    reasons.push('balance_unreadable');
  if (truncated.stuck || truncated.wallets) reasons.push('list_truncated');
  return {
    status: reasons.length > 0 ? 'attention' : 'clean',
    generatedAt: snapshot.generatedAt,
    staleAfterSeconds: snapshot.staleAfterSeconds,
    stuckTotal: snapshot.stuckTotal,
    stuck,
    walletsTotal: snapshot.walletsTotal,
    balances,
    truncated,
    reasons,
  };
}
