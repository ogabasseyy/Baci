import type { BalanceFinding, BalanceKind } from './daily-reconciliation';

export interface WalletExpectation {
  walletId: string;
  expectedKobo: number;
}

export interface BalanceReader {
  readWalletBalance: (walletId: string) => Promise<number>;
}

export function unreadableBalance(wallet: WalletExpectation): BalanceFinding {
  return {
    walletId: wallet.walletId,
    expectedKobo: wallet.expectedKobo,
    providerKobo: null,
    differenceKobo: null,
    kind: 'unreadable',
  };
}

export async function readBalance(
  ports: BalanceReader,
  wallet: WalletExpectation
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
    return unreadableBalance(wallet);
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

/**
 * The database snapshot and the provider balance are read minutes apart, so a
 * single low reading may be skew. Each shortfall is read once more (only
 * while `canRead()` says time remains) and pages only if it persists. A
 * re-read that cannot be read keeps the original shortfall: never hidden.
 */
export async function confirmShortfalls(
  ports: BalanceReader,
  balances: readonly BalanceFinding[],
  wallets: readonly WalletExpectation[],
  canRead: () => boolean
): Promise<BalanceFinding[]> {
  const confirmed: BalanceFinding[] = [];
  for (const [index, balance] of balances.entries()) {
    if (balance.kind !== 'below_expected' || !canRead()) {
      confirmed.push(balance);
      continue;
    }
    const again = await readBalance(ports, wallets[index]);
    confirmed.push(again.kind === 'unreadable' ? balance : again);
  }
  return confirmed;
}
