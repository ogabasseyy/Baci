import { router } from 'expo-router';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { createPrimaryWalletCardFundingClient } from '@/lib/primary-wallet-card';
import { useAuthStore } from '@/stores/auth-store';
import type { beginWalletTopUpCompletion } from './payment-gateway-completions';
import {
  getWalletReturnHref,
  WALLET_QUERY_KEY,
} from './payment-gateway-controller.helpers';

const client = createPrimaryWalletCardFundingClient();

export function beginPrimaryWalletCardCompletion(
  input: Parameters<typeof beginWalletTopUpCompletion>[0]
) {
  if (input.refs.paymentCompletionStartedRef.current) return;
  input.refs.paymentCompletionStartedRef.current = true;
  input.clearPendingLoadTimeout();
  input.setPaymentStatus('processing');
  void (async () => {
    let failureCause:
      | 'incomplete_details'
      | 'account_changed'
      | 'recovery_unconfirmed' = 'recovery_unconfirmed';
    try {
      const userId = useAuthStore.getState().user?.id;
      if (
        !userId ||
        !input.merchantId ||
        !input.reference ||
        input.gateway !== 'paystack' ||
        !isPiggyvestPrimaryMerchant(input.merchantId)
      ) {
        failureCause = 'incomplete_details';
        throw new Error('Primary card funding details are incomplete.');
      }
      const result = await client.recover({
        merchantId: input.merchantId,
        userId,
        reference: input.reference,
      });
      if (!input.refs.isMountedRef.current) {
        input.refs.paymentCompletionStartedRef.current = false;
        return;
      }
      const requireSameAccount = () => {
        if (useAuthStore.getState().user?.id !== userId) {
          failureCause = 'account_changed';
          throw new Error('The funding account changed.');
        }
      };
      requireSameAccount();
      if (result.status === 'abandoned') {
        input.refs.paymentCompletionStartedRef.current = false;
        input.setErrorMessage(
          'This card checkout was cancelled before payment. No money moved. Start a new funding to try again.'
        );
        input.setPaymentStatus('error');
        return;
      }
      if (result.status !== 'completed') {
        input.refs.paymentCompletionStartedRef.current = false;
        input.setErrorMessage(
          result.status === 'reconciliation_required'
            ? 'Your funding needs review. This operation is saved. Do not pay again; check its status later.'
            : 'We are waiting for funding confirmation. Money appears in your wallet once confirmed. This operation is saved. Do not pay again.'
        );
        input.setPaymentStatus('pending');
        return;
      }
      await input.queryClient.invalidateQueries({ queryKey: WALLET_QUERY_KEY });
      if (!input.refs.isMountedRef.current) {
        input.refs.paymentCompletionStartedRef.current = false;
        return;
      }
      requireSameAccount();
      input.setPaymentStatus('success');
      input.scheduleDelayedNavigation(() => {
        if (useAuthStore.getState().user?.id === userId)
          router.replace(getWalletReturnHref(result.returnTo));
      });
    } catch {
      // Redacted cause only: the error itself may carry provider or
      // account details, so log the classification, never the value.
      console.warn(`[primary-wallet-card] completion failed: ${failureCause}`);
      input.refs.paymentCompletionStartedRef.current = false;
      if (!input.refs.isMountedRef.current) return;
      input.setPaymentStatus('error');
      input.setErrorMessage(
        'Could not check your funding status. This does not mean your card charge failed. Your operation is saved. Do not pay again; check its status later.'
      );
    }
  })();
}
