import { router } from 'expo-router';
import { Alert } from 'react-native';
import { readPiggyvestCapabilityNow } from '@/lib/read-piggyvest-capability-now';
import { WALLET_TOP_UP_MIN_AMOUNT } from '@/lib/wallet-top-up-constants';

const IMEI_CHECK_RETURN_HREF = '/imei-check';

export const imeiCheckScreenActions = {
  alertInvalidIdentifier(identifier: 'imei' | 'serial' | 'both') {
    Alert.alert(
      identifier === 'serial' ? 'Invalid serial' : 'Invalid number',
      identifier === 'serial'
        ? 'Please enter a valid device serial number.'
        : identifier === 'imei'
          ? 'Please enter a valid 15-digit IMEI number.'
          : 'Please enter a valid IMEI or serial number.'
    );
  },
  fundWallet(
    amount: number,
    merchantId: string | null | undefined = undefined
  ) {
    // A store credit top-up is card-only, so a real shortfall is never
    // prefilled below the card minimum (the form would refuse it); an
    // unknown one (0) stays unfilled. Other customers keep today's prefill.
    // Re-read at navigation (Codex): the PiggyVest verdict may have turned
    // positive (or unknown) while the check request was in flight, and the
    // wallet sheet classifies this return by the verdict it sees now.
    // The live verdict alone decides (Codex): a rollback mid-request means
    // a legacy top-up of the exact shortfall, so no captured mode is taken.
    const storeCreditNow = readPiggyvestCapabilityNow(merchantId) !== false;
    const requiredAmount = storeCreditNow
      ? amount > 0
        ? Math.max(WALLET_TOP_UP_MIN_AMOUNT, Math.ceil(amount))
        : 0
      : Math.max(0, Math.ceil(amount));
    // Encoded like every other wallet return link (Muse).
    router.push(
      `/wallet?action=fund&requiredAmount=${requiredAmount}&returnTo=${encodeURIComponent(IMEI_CHECK_RETURN_HREF)}`
    );
  },
  networkErrorMessage(error: unknown) {
    return error instanceof Error && error.name === 'AbortError'
      ? 'Request timed out. Please check your connection and try again.'
      : 'Network error. Please check your connection and try again.';
  },
};
