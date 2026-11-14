/**
 * One ledger of the movements the S8 sandbox pass expects, shared by
 * `setupScenario` and every proof-10 step. A movement is settled only once
 * BOTH its source and destination balance were observed settled; a wallet is
 * quiet only when every movement that touched it, setup funding included, is
 * settled. A step that measures a wallet which is not quiet cannot tell its
 * own movement from an earlier one, so its money verdicts are unknown.
 */
export const EARLIER_UNSETTLED = 'earlier movement on this wallet unsettled';

export interface ExpectedMovement {
  /** null = money entering from outside the wallets (a deposit). */
  from: string | null;
  to: string | null;
  amountKobo: number;
  /** Both sides' balances were observed settled. */
  settled: boolean;
}

export class MovementLedger {
  private readonly movements: ExpectedMovement[] = [];

  append(movement: ExpectedMovement): void {
    this.movements.push({ ...movement });
  }

  /** True only when no unsettled movement touched any of these wallets. */
  isQuiet(...walletIds: string[]): boolean {
    return !this.movements.some(
      (m) => !m.settled && walletIds.some((id) => id === m.from || id === m.to)
    );
  }

  entries(): readonly ExpectedMovement[] {
    return this.movements;
  }
}
