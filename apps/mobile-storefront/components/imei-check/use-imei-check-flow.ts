import {
  IMEI_SERVICE_TIERS,
  type ImeiDeviceCategory,
  type ImeiReport,
  type ImeiServiceTierKey,
  resolveImeiReportDevice,
} from '@baci/shared/imei';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { useStoreCreditPurchaseCopy } from '@/hooks/use-store-credit-purchase-copy';
import { useWallet } from '@/hooks/use-wallet';
import { createLogger } from '@/lib/logger';
import {
  ImeiCheckApiResponseSchema,
  type ImeiResult,
  parseApiResponse,
} from '@/lib/validation';
import { useAuthStore } from '@/stores/auth-store';
import { applyImeiCheckFailure } from './apply-imei-check-failure';
import { decideImeiVerify } from './decide-imei-verify';
import { imeiAccountScope } from './imei-account-scope';
import { imeiCheckScreenActions } from './imei-check-screen-actions';
import { getImeiWalletCopy } from './imei-wallet-copy';
import { resolveImeiCheckFailure } from './resolve-imei-check-failure';
import { submitImeiCheck } from './submit-imei-check';
import { useImeiPendingLookup } from './use-imei-pending-lookup';
import { useImeiPendingTerminal } from './use-imei-pending-terminal';
import { useImeiRequestIdentity } from './use-imei-request-identity';
import { useImeiWalletPay } from './use-imei-wallet-pay';

const log = createLogger('ImeiChecker');

/**
 * The IMEI screen's check flow: pays from store credit, PiggyVest or a
 * top-up (main's rail decision), polls pending lookups, and reopens a
 * completed report from history without paying again.
 */
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
  const scope = imeiAccountScope({
    merchantId,
    customer: { id: customerId },
    session,
  });
  const scopeRef = useRef(scope);
  const submitting = useRef(false);
  useEffect(() => {
    scopeRef.current = scope;
    setResult(null);
    setResultLookupId(null);
    setError(null);
  }, [scope]);

  const showResult = (
    tier: ImeiServiceTierKey,
    lookupId: string | null,
    data: ImeiResult,
    device: ImeiDeviceCategory | null,
    shownScope = scope
  ) => {
    setError(null);
    setResultDevice(device ?? resolveImeiReportDevice(tier, null));
    setResultScope(shownScope);
    setResultTier(tier);
    setResultLookupId(lookupId);
    setResult(data);
  };
  const walletPay = useImeiWalletPay({
    apiBaseUrl: API_BASE_URL,
    device: selectedDevice,
    walletQuery,
    onDelivered: (paid) =>
      showResult(paid.tier, paid.lookupId, paid.result, selectedDevice),
  });

  // Checks spend the older balance: store credit for PiggyVest customers.
  const wallet = walletQuery.data?.wallet;
  const walletBalance = wallet?.balance ?? 0;
  const walletIsStoreCredit = useStoreCreditPurchaseCopy(merchantId, wallet);
  const walletCopy = getImeiWalletCopy(walletIsStoreCredit);
  const fundWallet = (amount: number) =>
    imeiCheckScreenActions.fundWallet(amount, merchantId);
  const clearIdempotencyKey = () => requestIdentity.clear();

  useImeiPendingTerminal(pendingLookup.terminal, (terminal) => {
    // Final: the saved key retires (a restored lookup brings its own).
    requestIdentity.clear(terminal.request);
    setIsLoading(false);
    if (terminal.kind === 'complete') {
      showResult(
        terminal.tier,
        terminal.lookupId,
        terminal.result,
        terminal.device ?? null
      );
    } else {
      setError(terminal.error);
    }
    pendingLookup.clearTerminal();
  });

  const handleVerify = async (
    tier: ImeiServiceTierKey,
    imei: string,
    device: ImeiDeviceCategory = selectedDevice,
    preserveResult = false
  ) => {
    Keyboard.dismiss();
    if (submitting.current || pendingLookup.pending) return;

    const serviceTier = IMEI_SERVICE_TIERS[tier];
    if (!imeiCheckScreenActions.isValidFor(imei, serviceTier, device))
      return setError(imeiCheckScreenActions.invalidFor(serviceTier, device));
    const decision = await decideImeiVerify({
      retainsStoreCredit: () => requestIdentity.retains(tier, imei, device),
      retainsPiggyvest: () => walletPay.retains(tier, imei),
      ownerAtTap: useAuthStore.getState().user?.id ?? null,
      currentOwner: () => useAuthStore.getState().user?.id ?? null,
      walletLoading: walletQuery.isLoading || walletPay.waitsForWallet,
      walletError: walletQuery.isError,
      piggyvestCovers: () => walletPay.covers(tier),
      walletBalance,
      price: serviceTier.price,
    });
    if (decision.kind === 'ignore') return;
    if (decision.kind !== 'pay')
      return setError(
        decision.kind === 'wait'
          ? `${walletCopy.loading} Please try again in a moment.`
          : walletCopy.unavailable
      );
    const { rail } = decision;
    if (rail === 'piggyvest') return void walletPay.open(tier, imei);
    if (rail === 'top_up')
      return void fundWallet(serviceTier.price - walletBalance);
    if (submitting.current || pendingLookup.pending) return;

    submitting.current = true;
    const submittedScope = scope;
    setIsLoading(true);
    setError(null);
    if (!preserveResult) setResult(null);

    // Saved on the phone before anything is sent: a retry after the app was
    // killed mid-request replays this key instead of paying again.
    const identity = await requestIdentity.get(tier, imei, device);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    const performCheck = async () => {
      // Switched account (nothing sent) or an unsaved key (fails closed).
      if (!('key' in identity)) return void setError(identity.error);
      if (scopeRef.current !== submittedScope) return;
      const { rawData, response } = await submitImeiCheck({
        // The live session: the tap awaited the saved keys (Codex P1).
        accessToken: useAuthStore.getState().session?.access_token,
        apiBaseUrl: API_BASE_URL,
        device,
        idempotencyKey: identity.key,
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
        await applyImeiCheckFailure(outcome, {
          clearKey: clearIdempotencyKey,
          signIn: () => router.push('/auth/login?returnTo=/imei-check'),
          topUp: fundWallet,
          refetchWallet: () => walletQuery.refetch?.(),
          showError: setError,
        });
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
          request: identity.saved,
        });
        return;
      }
      if (!validated?.success || !validated.data) {
        // An unreadable answer does not prove the paid request failed: the
        // key is kept so a retry replays it instead of paying again.
        setError('Invalid response from server. Please try again.');
        return;
      }

      clearIdempotencyKey();
      showResult(
        tier,
        validated.lookupId ?? null,
        validated.data,
        device,
        submittedScope
      );
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
    // A shown report must not let back navigation abandon an active paid check.
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
    // Everything about a shown report belongs to the account that opened it.
    result: resultScope === scope ? result : null,
    resultDevice: resultScope === scope ? resultDevice : null,
    resultLookupId: resultScope === scope ? resultLookupId : null,
    resultTier,
    session,
    customerId,
    merchantId,
    pendingLookup,
    walletPay,
    walletQuery,
    walletBalance,
    walletIsStoreCredit,
    fundWallet,
    handleVerify,
    handleReset,
    clearError() {
      setError(null);
    },
    /** Typing a new number drops only the invalid-number message. */
    dropInvalidIdentifierError() {
      setError(imeiCheckScreenActions.dropInvalidIdentifierError);
    },
    /** Shows a completed report from history: nothing is paid again. */
    openReport(report: ImeiReport, listedFor: string) {
      if (submitting.current || pendingLookup.pending) return;
      // Only a report listed for the account signed in right now (Muse).
      if (listedFor !== imeiAccountScope(useAuthStore.getState())) return;
      showResult(report.tier, report.lookupId, report.result, report.device);
    },
  };
}
