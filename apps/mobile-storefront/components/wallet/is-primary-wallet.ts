type PrimaryWalletInput = {
  fundingAccount?: { provider?: string | null } | null;
  primaryReady?: boolean;
  /** PiggyVest confirmed, balance pending, maybe no account yet (Codex). */
  savingsPrimary?: boolean;
};

/**
 * The wallet screen's PiggyVest verdict: the main wallet is ready, or the
 * account is PiggyVest with its balance still pending (Codex). Both are a
 * savings wallet; only the older balance is store credit.
 */
export function isPrimaryWallet({
  fundingAccount,
  primaryReady,
  savingsPrimary,
}: PrimaryWalletInput): boolean {
  return (
    primaryReady === true ||
    savingsPrimary === true ||
    fundingAccount?.provider === 'piggyvest'
  );
}
