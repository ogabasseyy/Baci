import {
  IMEI_SERVICE_TIERS,
  type ImeiDeviceCategory,
  type ImeiReport,
  type ImeiServiceTierKey,
  isValidDeviceIdentifier,
  resolveImeiReportDevice,
} from '@baci/shared/imei';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Alert, Keyboard } from 'react-native';
import { useWallet } from '@/hooks/use-wallet';
import { createLogger } from '@/lib/logger';
import {
  ImeiCheckApiResponseSchema,
  type ImeiResult,
  parseApiResponse,
} from '@/lib/validation';
import { useAuthStore } from '@/stores/auth-store';
import { imeiCheckScreenActions } from './imei-check-screen-actions';
import { resolveImeiCheckFailure } from './resolve-imei-check-failure';
import { submitImeiCheck } from './submit-imei-check';
import { useImeiPendingLookup } from './use-imei-pending-lookup';
import { useImeiRequestIdentity } from './use-imei-request-identity';

const log = createLogger('ImeiChecker');
export function useImeiCheckFlow(
  selectedDevice: ImeiDeviceCategory,
  API_BASE_URL: string
) {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ImeiResult | null>(null);
  const [resultLookupId, setResultLookupId] = useState<string | null>(null);
  const [resultTier, setResultTier] = useState<ImeiServiceTierKey>('full');
  const [error, setError] = useState<string | null>(null);
  const [resultDevice, setResultDevice] = useState<ImeiDeviceCategory | null>(
    null
  );
  const [resultScope, setResultScope] = useState('');
  const session = useAuthStore((state) => state.session);
  const customerId = useAuthStore((state) => state.customer?.id);
  const merchantId = useAuthStore((state) => state.merchantId ?? undefined);
  const walletQuery = useWallet();
  const pendingLookup = useImeiPendingLookup({
    accessToken: session?.access_token,
    userId: session?.user?.id,
    apiBaseUrl: API_BASE_URL,
    customerId,
    merchantId,
  });
  const requestIdentity = useImeiRequestIdentity(Crypto.randomUUID);
  const scope = `${merchantId}:${customerId}:${session?.user?.id ?? ''}`;
  const scopeRef = useRef(scope);
  const submitting = useRef(false);
  useEffect(() => {
    scopeRef.current = scope;
    setResult(null);
    setResultLookupId(null);
    setError(null);
  }, [scope]);

  const walletBalance = walletQuery.data?.wallet.balance ?? 0;

  const clearIdempotencyKey = () => {
    requestIdentity.clear();
  };

  const handlePendingTerminal = useEffectEvent(
    (terminal: NonNullable<typeof pendingLookup.terminal>) => {
      clearIdempotencyKey();
      setIsLoading(false);
      if (terminal.kind === 'complete') {
        setError(null);
        setResultDevice(
          terminal.device ?? resolveImeiReportDevice(terminal.tier, null)
        );
        setResultScope(scope);
        setResultTier(terminal.tier);
        setResultLookupId(terminal.lookupId);
        setResult(terminal.result);
      } else {
        setError(terminal.error);
      }
      pendingLookup.clearTerminal();
    }
  );

  useEffect(() => {
    if (pendingLookup.terminal) {
      handlePendingTerminal(pendingLookup.terminal);
    }
  }, [pendingLookup.terminal]);

  const handleVerify = async (
    tier: ImeiServiceTierKey,
    imei: string,
    device: ImeiDeviceCategory = selectedDevice,
    preserveResult = false
  ) => {
    Keyboard.dismiss();
    if (submitting.current || pendingLookup.pending) return;

    const serviceTier = IMEI_SERVICE_TIERS[tier];
    if (!isValidDeviceIdentifier(imei, serviceTier.identifier)) {
      Alert.alert(
        serviceTier.identifier === 'serial'
          ? 'Invalid serial'
          : 'Invalid number',
        serviceTier.identifier === 'serial'
          ? 'Please enter a valid device serial number.'
          : serviceTier.identifier === 'imei'
            ? 'Please enter a valid 15-digit IMEI number.'
            : 'Please enter a valid IMEI or serial number.'
      );
      return;
    }

    if (walletQuery.isLoading) {
      setError('Loading wallet balance. Please wait a moment and try again.');
      return;
    }
    if (walletQuery.isError) {
      setError(
        'Wallet balance unavailable. Refresh your wallet and try again.'
      );
      return;
    }
    if (walletBalance < serviceTier.price) {
      imeiCheckScreenActions.fundWallet(serviceTier.price - walletBalance);
      return;
    }

    submitting.current = true;
    const submittedScope = scope;
    setIsLoading(true);
    setError(null);
    if (!preserveResult) setResult(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    const performCheck = async () => {
      const idempotencyKey = requestIdentity.get(tier, imei, scope);
      const { rawData, response } = await submitImeiCheck({
        accessToken: session?.access_token,
        apiBaseUrl: API_BASE_URL,
        device,
        idempotencyKey,
        identifier: imei,
        signal: controller.signal,
        tier,
      });
      if (scopeRef.current !== submittedScope) return;
      if (!response.ok || rawData?.error) {
        const outcome = resolveImeiCheckFailure({
          currentTierPrice: serviceTier.price,
          payload: rawData,
          responseStatus: response.status,
          walletBalance,
        });

        if (outcome.shouldClearIdempotencyKey) {
          clearIdempotencyKey();
        }
        if (outcome.shouldRedirectToLogin) {
          router.push('/auth/login?returnTo=/imei-check');
          return;
        }
        if (outcome.topUpAmount !== null) {
          imeiCheckScreenActions.fundWallet(outcome.topUpAmount);
          return;
        }
        if (outcome.shouldRefetchWallet) {
          await walletQuery.refetch?.();
        }
        if (outcome.errorMessage) {
          setError(outcome.errorMessage);
        }
        return;
      }

      const validated = parseApiResponse(
        ImeiCheckApiResponseSchema,
        rawData,
        'IMEI check API'
      );
      if (
        validated?.success &&
        validated.status === 'pending' &&
        validated.lookupId
      ) {
        await pendingLookup.start({
          lookupId: validated.lookupId,
          pollAfterMs: validated.pollAfterMs ?? 2_000,
          tier,
          device,
        });
        return;
      }
      if (!validated?.success || !validated.data) {
        // An unreadable response does not prove the paid request failed.
        setError('Invalid response from server. Please try again.');
        return;
      }

      clearIdempotencyKey();
      setResultDevice(device);
      setResultScope(submittedScope);
      setResultTier(tier);
      setResultLookupId(validated.lookupId ?? null);
      setResult(validated.data);
    };

    await performCheck()
      .catch((err: unknown) => {
        if (scopeRef.current !== submittedScope) return;
        log.error('IMEI check failed:', err);
        setError(imeiCheckScreenActions.networkErrorMessage(err));
      })
      .finally(() => {
        clearTimeout(timeoutId);
        submitting.current = false;
        setIsLoading(false);
      });
  };

  const handleReset = () => {
    // A retained report must not let back navigation abandon an active paid check.
    if (submitting.current || pendingLookup.pending) return;
    // Keep uncertain identities: retrying this same check must reuse its key.
    void pendingLookup.clear();
    setResult(null);
    setResultLookupId(null);
    setError(null);
  };

  return {
    error,
    isLoading,
    result: resultScope === scope ? result : null,
    resultDevice,
    resultLookupId,
    resultTier,
    session,
    customerId,
    merchantId,
    pendingLookup,
    walletQuery,
    walletBalance,
    handleVerify,
    handleReset,
    clearError() {
      setError(null);
    },
    openReport(report: ImeiReport) {
      if (submitting.current || pendingLookup.pending) return;
      setError(null);
      setResultScope(scope);
      setResultDevice(report.device);
      setResultLookupId(report.lookupId);
      setResultTier(report.tier);
      setResult(report.result);
    },
  };
}
