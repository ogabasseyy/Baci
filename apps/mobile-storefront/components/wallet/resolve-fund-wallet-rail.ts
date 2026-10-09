import { Alert } from 'react-native';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { getPiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import { readObservedPiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability-cache';

/**
 * Resolves which rail a wallet funding must use. Known verdicts (and the
 * pilot allowlist) resolve synchronously; an unknown verdict awaits the
 * authoritative probe instead of defaulting to legacy, so a quick tap on
 * a cold start cannot mint a legacy top-up the server would have routed
 * primary moments later. An ambiguous probe failure blocks funding
 * ('blocked', after alerting) rather than guessing a rail with money on
 * the line.
 */
export async function resolveFundWalletRail(
  activeMerchantId?: string
): Promise<'primary' | 'legacy' | 'blocked'> {
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
      Alert.alert(
        'Unable to fund wallet',
        'We could not confirm your wallet rail. Please try again.'
      );
      return 'blocked';
    }
  }
  return 'legacy';
}
