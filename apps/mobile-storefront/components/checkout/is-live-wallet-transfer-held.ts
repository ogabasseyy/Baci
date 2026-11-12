import type { PiggyvestShortfallVerdict } from '@/lib/prompt-piggyvest-utility-shortfall';

export interface LiveWalletTransferReaders {
  getWalletError: () => Error | null;
  getWalletVerdict: (options?: {
    holdUnsettled?: boolean;
  }) => PiggyvestShortfallVerdict;
  isFetchingNow: () => boolean;
}

/**
 * Re-checks the cached wallet at order submit (Codex): a refresh that
 * starts or lands as PiggyVest after Place Order must stop the
 * wallet-funded bank transfer, so the order uses the standard per-order
 * transfer. Merchants the server rules out keep today's behaviour.
 */
export function isLiveWalletTransferHeld(
  readers: LiveWalletTransferReaders,
  piggyvestPossible: boolean
): boolean {
  const verdict = readers.getWalletVerdict({
    holdUnsettled: piggyvestPossible,
  });
  return (
    verdict.walletIsStoreCredit === true ||
    verdict.walletPrimaryUnknown === true ||
    (piggyvestPossible &&
      (readers.isFetchingNow() || readers.getWalletError() != null))
  );
}
