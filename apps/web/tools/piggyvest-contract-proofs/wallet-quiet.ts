/**
 * Which wallets an earlier S8 step left with an unsettled or unmeasured
 * movement. One instance is threaded through the proof-10 sequence (deposit,
 * fund, double tap, timeout): a later step that measures a wallet that is not
 * quiet cannot tell its own movement from the earlier one, so its money
 * verdicts are unknown.
 */
export const EARLIER_UNSETTLED = 'earlier movement on this wallet unsettled';

export class WalletsQuiet {
  private readonly noisy = new Set<string>();

  /** An earlier step may still move, or never measured, these wallets. */
  markNotQuiet(...walletIds: string[]): void {
    for (const id of walletIds) this.noisy.add(id);
  }

  /** True only when no earlier step left any of these wallets unsettled. */
  isQuiet(...walletIds: string[]): boolean {
    return walletIds.every((id) => !this.noisy.has(id));
  }
}
