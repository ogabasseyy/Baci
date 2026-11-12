import { router } from 'expo-router';
import { Alert } from 'react-native';
import { WALLET_TOP_UP_MIN_AMOUNT } from '@/lib/wallet-top-up-constants';

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
  fundWallet(amount: number) {
    // A real shortfall is never prefilled below the card top-up minimum
    // (the card form would refuse it); an unknown one (0) stays unfilled.
    const requiredAmount =
      amount > 0 ? Math.max(WALLET_TOP_UP_MIN_AMOUNT, Math.ceil(amount)) : 0;
    router.push(
      `/wallet?action=fund&requiredAmount=${requiredAmount}&returnTo=/imei-check`
    );
  },
  networkErrorMessage(error: unknown) {
    return error instanceof Error && error.name === 'AbortError'
      ? 'Request timed out. Please check your connection and try again.'
      : 'Network error. Please check your connection and try again.';
  },
};
