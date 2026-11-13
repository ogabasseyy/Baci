import { Alert } from 'react-native';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { isWalletPurchaseReturnHref } from '@/lib/is-wallet-purchase-return-href';
import { getPiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import { readObservedPiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability-cache';
import { discardUnreadablePrimaryCardFunding } from './discard-unreadable-primary-card-funding';
import { hasRetainedPrimaryCardFunding } from './has-retained-primary-card-funding';
import { isSameSignedInUser } from './is-same-signed-in-user';

/**
 * Resolves which rail a wallet funding must use. Known verdicts (and the
 * pilot allowlist) resolve synchronously; an unknown verdict awaits the
 * authoritative probe instead of defaulting to legacy, so a quick tap on
 * a cold start cannot mint a legacy top-up the server would have routed
 * primary moments later. An ambiguous probe failure blocks funding
 * ('blocked', after alerting) rather than guessing a rail with money on
 * the line — the verdict stays fail-closed, but the alert offers a retry
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
    const retained = await hasRetainedPrimaryCardFunding(
      activeMerchantId,
      options?.userId
    );
    // A saved funding we can't read may still charge (Codex): never start a
    // second card charge silently. The customer can cancel, or knowingly
    // clear it and continue; a charged payment still lands in savings.
    if (retained === 'unreadable') {
      const onRetry = options?.onRetry;
      Alert.alert(
        'Earlier card payment unreadable',
        'We could not read an earlier card payment on this device. If it was charged, the money will still appear in your savings wallet. Continue to add store credit for this purchase?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Continue anyway',
            onPress: () => {
              // The alert can outlive an account switch (Codex): the retry
              // carries the previous account's funding, so continue only
              // for the account that started it.
              if (!isSameSignedInUser(options?.userId)) {
                Alert.alert(
                  'Signed-in account changed',
                  'You switched accounts. Start the top-up again from this account.'
                );
                return;
              }
              void discardUnreadablePrimaryCardFunding(
                activeMerchantId,
                options?.userId
              ).then((cleared) => {
                if (cleared) {
                  onRetry?.();
                  return;
                }
                // Storage kept the record (Codex): retrying now would only
                // reopen this prompt, so say so and let the customer retry.
                Alert.alert(
                  'Could not update this device',
                  'We could not clear the earlier card payment from this device. Please try again in a moment.'
                );
              });
            },
          },
        ]
      );
      return 'blocked';
    }
    // The read awaited storage (Codex): an account switch meanwhile must not
    // release this flow's funding under the new account's token.
    if (options?.userId && !isSameSignedInUser(options.userId)) {
      Alert.alert(
        'Signed-in account changed',
        'You switched accounts. Start the top-up again from this account.'
      );
      return 'blocked';
    }
    return retained ? 'primary' : 'legacy';
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
      if (options?.onRetry) {
        const onRetry = options.onRetry;
        Alert.alert(
          'Unable to fund wallet',
          'We could not confirm your wallet rail. Please try again.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Try again', onPress: onRetry },
          ]
        );
      } else {
        Alert.alert(
          'Unable to fund wallet',
          'We could not confirm your wallet rail. Please try again.'
        );
      }
      return 'blocked';
    }
  }
  return 'legacy';
}
