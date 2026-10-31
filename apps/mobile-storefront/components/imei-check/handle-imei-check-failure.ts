import {
  type IMEI_SERVICE_TIERS,
  type ImeiServiceTierKey,
  isValidDeviceIdentifier,
} from '@baci/shared/imei';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { clearImeiRecoveryKey } from '@/lib/imei-request-recovery';
import { ImeiCheckApiResponseSchema } from '@/lib/validation';
import { imeiCheckScreenActions } from './imei-check-screen-actions';
import { resolveImeiCheckFailure } from './resolve-imei-check-failure';

export function validateImeiCheckInput(
  imei: string,
  identifier: (typeof IMEI_SERVICE_TIERS)[ImeiServiceTierKey]['identifier']
) {
  if (isValidDeviceIdentifier(imei, identifier)) return true;
  Alert.alert(
    identifier === 'serial' ? 'Invalid serial' : 'Invalid number',
    identifier === 'serial'
      ? 'Please enter a valid device serial number.'
      : identifier === 'imei'
        ? 'Please enter a valid 15-digit IMEI number.'
        : 'Please enter a valid IMEI or serial number.'
  );
  return false;
}

export async function handleImeiCheckFailure({
  rawData,
  responseStatus,
  price,
  walletBalance,
  recovery,
  refetchWallet,
  setError,
  onPreviousReport,
}: {
  rawData: unknown;
  responseStatus: number;
  price: number;
  walletBalance: number;
  recovery: { storageKey: string; idempotencyKey: string };
  refetchWallet?: () => Promise<unknown>;
  setError: (value: string) => void;
  onPreviousReport: (id: string) => void;
}) {
  const failure = ImeiCheckApiResponseSchema.safeParse(rawData);
  if (
    failure.success &&
    typeof rawData === 'object' &&
    rawData !== null &&
    'code' in rawData &&
    rawData.code === 'PREVIOUS_REPORT_AVAILABLE' &&
    failure.data.lookupId
  )
    onPreviousReport(failure.data.lookupId);
  const outcome = resolveImeiCheckFailure({
    currentTierPrice: price,
    payload: rawData,
    responseStatus,
    walletBalance,
  });
  if (outcome.shouldClearIdempotencyKey)
    await clearImeiRecoveryKey(
      recovery.storageKey,
      recovery.idempotencyKey
    ).catch(() => undefined);
  if (outcome.shouldRedirectToLogin) {
    router.push('/auth/login?returnTo=/imei-check');
    return;
  }
  if (outcome.topUpAmount !== null) {
    imeiCheckScreenActions.fundWallet(outcome.topUpAmount);
    return;
  }
  if (outcome.shouldRefetchWallet) await refetchWallet?.();
  if (outcome.errorMessage) setError(outcome.errorMessage);
}

export function handleImeiPreparationFailure(
  preparation: Exclude<
    Awaited<
      ReturnType<typeof import('./prepare-imei-attempt').prepareImeiAttempt>
    >,
    { kind: 'ready' }
  >,
  setError: (value: string) => void
) {
  if (preparation.kind === 'insufficient') {
    imeiCheckScreenActions.fundWallet(preparation.shortfall);
  } else {
    const messages = {
      storage_error:
        'This device cannot save check recovery. Please try again.',
      wallet_loading:
        'Loading wallet balance. Please wait a moment and try again.',
      wallet_error:
        'Wallet balance unavailable. Refresh your wallet and try again.',
    };
    setError(messages[preparation.kind]);
  }
}

export function imeiReportScopeKey(
  scope: string,
  tier: ImeiServiceTierKey,
  imei: string
) {
  return JSON.stringify([scope, tier, imei.trim().toUpperCase()]);
}
