import type { QueryClient } from '@tanstack/react-query';
import { type Href, router } from 'expo-router';
import {
  SavingsAuthorizationStillProcessingError,
  waitForSavingsAuthorizationConfirmation,
} from '@/lib/customer-savings';
import {
  clearWalletFundingIntentIfUnchanged,
  readWalletFundingIntentSnapshot,
} from '@/lib/wallet-funding-intent';
import {
  WalletTopUpStillProcessingError,
  waitForWalletTopUpConfirmation,
} from '@/lib/wallet-top-up';
import {
  getWalletReturnHref,
  isWalletTopUpGateway,
  WALLET_QUERY_KEY,
} from './payment-gateway-controller.helpers';
import type {
  PaymentGatewayRefs,
  PaymentStatusSetter,
} from './payment-gateway-controller.types';

interface SharedCompletionInput {
  clearPendingLoadTimeout: () => void;
  gateway?: string;
  merchantId?: string;
  merchantSlug?: string;
  queryClient: QueryClient;
  reference?: string;
  refs: PaymentGatewayRefs;
  scheduleDelayedNavigation: (navigate: () => void) => void;
  setConfirmedOperationReference?: (reference: string | null) => void;
  setErrorMessage: (message: string | null) => void;
  setPaymentStatus: PaymentStatusSetter;
  setTerminalDirective?: (message: string | null) => void;
}

export function beginWalletTopUpCompletion({
  clearPendingLoadTimeout,
  gateway,
  merchantId,
  merchantSlug,
  queryClient,
  reference,
  refs,
  returnTo,
  scheduleDelayedNavigation,
  setErrorMessage,
  setPaymentStatus,
}: SharedCompletionInput & { returnTo?: string }) {
  if (!isWalletTopUpGateway(gateway) || !reference) {
    setPaymentStatus('error');
    setErrorMessage('Wallet top-up details are incomplete.');
    return;
  }
  if (refs.paymentCompletionStartedRef.current) {
    return;
  }

  refs.paymentCompletionStartedRef.current = true;
  clearPendingLoadTimeout();
  setPaymentStatus('processing');

  void (async () => {
    try {
      const fundingIntentSnapshot = await readWalletFundingIntentSnapshot();
      await waitForWalletTopUpConfirmation({
        gateway,
        merchantId,
        merchantSlug,
        reference,
      });
      // Confirmation is authoritative. Intent cleanup is best-effort and must
      // happen even if the screen unmounted while the provider was settling;
      // a storage failure must never turn a confirmed credit into retry UI.
      await clearWalletFundingIntentIfUnchanged(fundingIntentSnapshot);
      if (!refs.isMountedRef.current) {
        return;
      }
      await queryClient.invalidateQueries({ queryKey: WALLET_QUERY_KEY });
      if (!refs.isMountedRef.current) {
        return;
      }
      setPaymentStatus('success');
      scheduleDelayedNavigation(() => {
        router.replace(getWalletReturnHref(returnTo));
      });
    } catch (error) {
      if (!refs.isMountedRef.current) {
        return;
      }

      refs.paymentCompletionStartedRef.current = false;
      setPaymentStatus('error');
      setErrorMessage(
        error instanceof WalletTopUpStillProcessingError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Wallet top-up could not be confirmed.'
      );
    }
  })();
}

export function beginSavingsAuthorizationCompletion({
  clearPendingLoadTimeout,
  merchantId,
  merchantSlug,
  queryClient,
  reference,
  refs,
  returnTo,
  scheduleDelayedNavigation,
  setErrorMessage,
  setPaymentStatus,
}: SharedCompletionInput & { returnTo?: string }) {
  if (!reference) {
    setPaymentStatus('error');
    setErrorMessage('Savings authorization details are incomplete.');
    return;
  }
  if (refs.paymentCompletionStartedRef.current) {
    return;
  }

  refs.paymentCompletionStartedRef.current = true;
  setPaymentStatus('processing');
  refs.savingsAuthorizationAbortRef.current?.abort();
  const abortController = new AbortController();
  refs.savingsAuthorizationAbortRef.current = abortController;

  void (async () => {
    try {
      await waitForSavingsAuthorizationConfirmation({
        merchantId,
        merchantSlug,
        reference,
        signal: abortController.signal,
      });
      if (!refs.isMountedRef.current) {
        return;
      }
      clearPendingLoadTimeout();
      await queryClient.invalidateQueries({ queryKey: WALLET_QUERY_KEY });
      if (!refs.isMountedRef.current) {
        return;
      }
      setPaymentStatus('success');
      scheduleDelayedNavigation(() => {
        router.replace((returnTo || '/wallet/savings/start') as Href);
      });
    } catch (error) {
      if (!refs.isMountedRef.current) {
        return;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      refs.paymentCompletionStartedRef.current = false;
      setPaymentStatus('error');
      setErrorMessage(
        error instanceof SavingsAuthorizationStillProcessingError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Savings card authorization could not be confirmed.'
      );
    } finally {
      if (refs.savingsAuthorizationAbortRef.current === abortController) {
        refs.savingsAuthorizationAbortRef.current = null;
      }
    }
  })();
}
