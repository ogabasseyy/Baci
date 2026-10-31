import { payoutVisible, settingsVisible } from './mock-sandbox-lag';
import type { MockOptions, Wallet } from './mock-sandbox-types';

/**
 * The interest fields a wallet readback shows right now. Reading consumes the
 * wallet's hidden-read counters, so each call is one read. `none` shows
 * nothing; `accrual_only` never shows the payout destination; a goal wallet can
 * omit it on request; and while its own lag lasts only the destination is missing.
 */
export function interestSettings(
  wallet: Wallet,
  options: MockOptions,
  isDefaultWallet: boolean
): Record<string, unknown> {
  if (options.payoutReadback === 'none' || !settingsVisible(wallet)) return {};
  const omitsPayout =
    options.payoutReadback === 'accrual_only' ||
    (options.goalReadbackOmitsPayout && !isDefaultWallet);
  return {
    enable_interest_accrual: wallet.interestEnabled,
    ...(omitsPayout || !payoutVisible(wallet)
      ? {}
      : { interest_payout_wallet: wallet.payoutWalletId }),
  };
}
