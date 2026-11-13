import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { isWalletPurchaseReturnHref } from '@/lib/is-wallet-purchase-return-href';
import { getPiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import { readObservedPiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability-cache';
import { askWalletFund } from './fund/ask-wallet-fund';
import { hasRetainedPrimaryCardFunding } from './has-retained-primary-card-funding';
import { notifySavings } from './savings/notify-savings';

/**
 * Resolves which rail a wallet funding must use. Known verdicts (and the
 * pilot allowlist) resolve synchronously; an unknown verdict awaits the
 * authoritative probe instead of defaulting to legacy, so a quick tap on
 * a cold start cannot mint a legacy top-up the server would have routed
 * primary moments later. An ambiguous probe failure blocks funding
 * ('blocked', after an inline notice) rather than guessing a rail with money on
 * the line — the verdict stays fail-closed, but the inline question offers a retry
 * (via onRetry) so a transient probe failure is not a dead end.
 *
 * A blank merchant id is NOT an unknown verdict: it is a supported
 * slug-scoped funding mode (initialize falls back to the auth/config
 * merchant slug, so scope is never missing at money time), and primary
 * is unreachable without an id (pilot, observed, and probe paths all
 * key on it). Defaulting 'legacy' there is the only servable rail, not
 * a guess — blocking would break slug-fallback top-ups.
 */
export async function resolveFundWalletRail(
  activeMerchantId?: string,
  options?: { onRetry?: () => void; userId?: string; walletReturnTo?: string }
): Promise<'primary' | 'legacy' | 'blocked'> {
  // A top-up for a purchase (IMEI check, utilities) adds store credit: those
  // purchases spend the legacy balance, never the PiggyVest savings wallet.
  // A saved PiggyVest card funding (maybe already charged) is recovered
  // first through the primary path, never doubled by a new legacy charge.
  if (isWalletPurchaseReturnHref(options?.walletReturnTo)) {
    return (await hasRetainedPrimaryCardFunding(
      activeMerchantId,
      options?.userId
    ))
      ? 'primary'
      : 'legacy';
  }
  if (isPiggyvestPrimaryMerchant(activeMerchantId)) return 'primary';
  if (
    activeMerchantId &&
    readObservedPiggyvestPrimaryCapability(activeMerchantId) === null
  ) {
    try {
      return (await getPiggyvestPrimaryCapability(activeMerchantId))
        ? 'primary'
        : 'legacy';
    } catch {
      const title = 'We couldn’t check your wallet';
      const message =
        'Nothing was charged. Check your connection, then try again.';
      // Asked inline (never an iOS alert); the answer is not awaited so the
      // caller still sees 'blocked' at once.
      if (options?.onRetry) {
        const onRetry = options.onRetry;
        void askWalletFund(title, message, 'Try again').then((retry) => {
          if (retry) onRetry();
        });
      } else {
        notifySavings(title, message, 'warning');
      }
      return 'blocked';
    }
  }
  return 'legacy';
}
