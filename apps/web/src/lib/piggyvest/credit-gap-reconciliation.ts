import {
  type CreditGapLedgerWallet,
  piggyvestCreditGapSchemas as schemas,
} from '@/schemas/piggyvest-credit-gap';
/**
 * The credit-gap check. It only reads: for each mapped plan wallet it lists
 * the credits PiggyVest made and compares their PVB credit ids with the
 * `pvb_reference` values our two credit ledgers recorded. It never writes a
 * credit or moves money; a person resolves each finding (replay the stored
 * webhook capture, or repair by hand).
 *
 * Findings:
 * - `unrecorded_credit` (pages): a successful PiggyVest credit, older than
 *   SETTLE_MS, that neither ledger recorded. Wallet-to-wallet (`p2p`) credits
 *   are our own savings transfers, tracked by the transfer reconciliation, so
 *   they are counted and skipped here.
 * - `not_on_provider` (pages): an inflow we recorded that PiggyVest's list
 *   for that wallet does not show as settled (missing, pending or failed).
 * - `interest_not_listed` (review only): the same for an interest payout.
 *   Whether the transaction list shows interest rows is not yet confirmed
 *   (contract evidence 2026-10-31: none observed at 0% sandbox rates), so
 *   this never pages until a live payout proves it does.
 * - `partial_credit` (review only): a settled `partial` PiggyVest credit
 *   neither ledger recorded. Some money may have moved, so a person looks;
 *   `pending` and `failed` credits moved none and are ignored.
 * - `unverified_reference` (review only): the list id does not have the
 *   PVB credit-id shape (`PVB01…`), so the list may use another id namespace
 *   than our `pvb_reference` and a mismatch proves nothing. When a wallet's
 *   settled list rows carry no PVB-shaped id at all, its recorded inflows
 *   missing from the list are downgraded to this kind too, instead of
 *   paging `not_on_provider` for every wallet. Confirm list id ===
 *   pvb_reference on the first live credit.
 * - `list_namespace_unproven` (pages, once per wallet): that downgrade
 *   happened, so recorded inflows could not be matched at all. The check
 *   never goes silent because the list changed shape.
 *
 * Interest surplus alone (a wallet holding more than recorded principal) is
 * the balance check's `above_expected` and stays non-paging; this check only
 * pages on a specific PVB credit id.
 */
import {
  type CreditGapKind,
  EDGE_MS,
  INTERNAL_CATEGORIES,
  PVB_CREDIT_ID,
  REVIEW_ONLY,
  SETTLE_MS,
} from './credit-gap-kinds';
import type {
  ProviderCredit,
  ProviderCreditListing,
} from './credit-gap-provider-reader';

export {
  type CreditGapKind,
  EDGE_MS,
  SETTLE_MS,
} from './credit-gap-kinds';

export interface CreditGapFinding {
  walletId: string;
  reference: string;
  kind: CreditGapKind;
  amountKobo: number | null;
  category: string | null;
  at: string;
}

export type CreditGapUncheckedReason =
  | 'list_unreadable'
  | 'list_incomplete'
  | 'ledger_truncated'
  | 'deadline';

export interface CreditGapUnchecked {
  walletId: string;
  reason: CreditGapUncheckedReason;
}

export type CreditGapReport =
  | { status: 'failed'; reason: 'snapshot_unavailable' | 'snapshot_invalid' }
  | {
      status: 'checked';
      windowStart: string;
      walletsTotal: number;
      walletsChecked: number;
      walletsDeferred: number;
      findings: CreditGapFinding[];
      unchecked: CreditGapUnchecked[];
      internalSkipped: number;
      unkeyed: number;
    };

export interface CreditGapPorts {
  loadLedger: () => Promise<unknown>;
  listWalletCredits: (
    walletId: string,
    sinceMs: number
  ) => Promise<ProviderCreditListing>;
  /** True once no new provider read may start. */
  expired: () => boolean;
}

const MAX_CONCURRENT_READS = 5;

export interface WalletComparison {
  findings: CreditGapFinding[];
  internalSkipped: number;
}

/** Pure: one wallet's ledger rows against its PiggyVest credits. */
export function compareWalletCredits(
  wallet: CreditGapLedgerWallet,
  credits: readonly ProviderCredit[],
  window: { startMs: number; generatedMs: number }
): WalletComparison {
  const recorded = new Set(
    [...wallet.inflow, ...wallet.interest].map((row) => row.reference)
  );
  const isSettled = (credit: ProviderCredit) =>
    credit.status === 'successful' || credit.status === 'partial';
  // Only settled rows prove PiggyVest shows the money: a recorded inflow
  // whose row is pending or failed is still `not_on_provider`.
  const listed = new Set(credits.filter(isSettled).map((credit) => credit.id));
  const findings: CreditGapFinding[] = [];
  let internalSkipped = 0;
  for (const credit of credits) {
    if (!isSettled(credit) || recorded.has(credit.id)) continue;
    if (INTERNAL_CATEGORIES.has(credit.category.trim().toLowerCase())) {
      internalSkipped += 1;
      continue;
    }
    // A young credit's webhook may still be in PiggyVest's retries.
    if (Date.parse(credit.createdAt) > window.generatedMs - SETTLE_MS) continue;
    findings.push({
      walletId: wallet.walletId,
      reference: credit.id,
      kind: !PVB_CREDIT_ID.test(credit.id)
        ? 'unverified_reference'
        : credit.status === 'partial'
          ? 'partial_credit'
          : 'unrecorded_credit',
      amountKobo: credit.amountKobo,
      category: credit.category,
      at: credit.createdAt,
    });
  }
  // Only rows well inside the listed window, so clock skew at either edge
  // cannot make a listed credit look missing.
  const inWindow = (at: string) => {
    const atMs = Date.parse(at);
    return (
      atMs >= window.startMs + EDGE_MS && atMs <= window.generatedMs - EDGE_MS
    );
  };
  const reverse = (
    rows: CreditGapLedgerWallet['inflow'],
    kind: CreditGapKind
  ) => {
    for (const row of rows)
      if (inWindow(row.at) && !listed.has(row.reference))
        findings.push({
          walletId: wallet.walletId,
          reference: row.reference,
          kind,
          amountKobo: null,
          category: null,
          at: row.at,
        });
  };
  // A settled listing with no PVB-shaped id cannot prove an inflow missing.
  const settled = credits.filter(isSettled);
  const namespaceUnproven =
    settled.length > 0 && !settled.some((c) => PVB_CREDIT_ID.test(c.id));
  const before = findings.length;
  reverse(
    wallet.inflow,
    namespaceUnproven ? 'unverified_reference' : 'not_on_provider'
  );
  // The downgrade must not silence a real gap: one paging line per wallet
  // says its recorded inflows could not be matched at all.
  if (namespaceUnproven && findings.length > before)
    findings.push({
      walletId: wallet.walletId,
      reference: 'list ids are not PVB01 credit ids',
      kind: 'list_namespace_unproven',
      amountKobo: null,
      category: null,
      at: new Date(window.generatedMs).toISOString(),
    });
  reverse(wallet.interest, 'interest_not_listed');
  return { findings, internalSkipped };
}

type WalletResult =
  | { checked: true; comparison: WalletComparison }
  | { checked: false; unchecked: CreditGapUnchecked };

async function checkWallet(
  ports: CreditGapPorts,
  wallet: CreditGapLedgerWallet,
  window: { startMs: number; generatedMs: number }
): Promise<WalletResult> {
  const unchecked = (reason: CreditGapUncheckedReason): WalletResult => ({
    checked: false,
    unchecked: { walletId: wallet.walletId, reason },
  });
  if (wallet.inflowTruncated || wallet.interestTruncated)
    return unchecked('ledger_truncated');
  let listing: ProviderCreditListing;
  try {
    listing = await ports.listWalletCredits(wallet.walletId, window.startMs);
  } catch {
    return unchecked('list_unreadable');
  }
  if (listing.outcome === 'unreadable') return unchecked('list_unreadable');
  if (listing.outcome === 'incomplete')
    return unchecked(
      listing.reason === 'deadline' ? 'deadline' : 'list_incomplete'
    );
  return {
    checked: true,
    comparison: compareWalletCredits(wallet, listing.credits, window),
  };
}

export async function runCreditGapCheck(
  ports: CreditGapPorts
): Promise<CreditGapReport> {
  let loaded: unknown;
  try {
    loaded = await ports.loadLedger();
  } catch {
    return { status: 'failed', reason: 'snapshot_unavailable' };
  }
  const parsed = schemas.ledgerSnapshot.safeParse(loaded);
  if (!parsed.success) return { status: 'failed', reason: 'snapshot_invalid' };
  const snapshot = parsed.data;
  const window = {
    startMs: Date.parse(snapshot.windowStart),
    generatedMs: Date.parse(snapshot.generatedAt),
  };
  const results: WalletResult[] = [];
  for (
    let start = 0;
    start < snapshot.wallets.length;
    start += MAX_CONCURRENT_READS
  ) {
    const batch = snapshot.wallets.slice(start, start + MAX_CONCURRENT_READS);
    if (ports.expired()) {
      results.push(
        ...batch.map(
          (wallet): WalletResult => ({
            checked: false,
            unchecked: { walletId: wallet.walletId, reason: 'deadline' },
          })
        )
      );
      continue;
    }
    results.push(
      ...(await Promise.all(
        batch.map((wallet) => checkWallet(ports, wallet, window))
      ))
    );
  }
  const findings: CreditGapFinding[] = [];
  const unchecked: CreditGapUnchecked[] = [];
  let internalSkipped = 0;
  for (const result of results) {
    if (!result.checked) {
      unchecked.push(result.unchecked);
      continue;
    }
    findings.push(...result.comparison.findings);
    internalSkipped += result.comparison.internalSkipped;
  }
  return {
    status: 'checked',
    windowStart: snapshot.windowStart,
    walletsTotal: snapshot.walletsTotal,
    walletsChecked: results.length - unchecked.length,
    walletsDeferred: snapshot.walletsDeferred,
    findings,
    unchecked,
    internalSkipped,
    unkeyed: snapshot.wallets.reduce((sum, wallet) => sum + wallet.unkeyed, 0),
  };
}

/** Whether this section needs a page: a missing credit or an unchecked wallet. */
export function creditGapPages(report: CreditGapReport): boolean {
  if (report.status === 'failed') return true;
  return (
    report.unchecked.length > 0 ||
    report.findings.some((finding) => !REVIEW_ONLY.has(finding.kind))
  );
}
