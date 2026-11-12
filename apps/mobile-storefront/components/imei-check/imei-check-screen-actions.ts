import { router } from 'expo-router';
import { Alert } from 'react-native';

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
    const requiredAmount = Math.max(0, Math.ceil(amount));
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
