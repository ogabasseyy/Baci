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
    try {
      const userId = useAuthStore.getState().user?.id;
      if (
        !userId ||
        !input.merchantId ||
        !input.reference ||
        input.gateway !== 'paystack' ||
        !isPiggyvestPrimaryMerchant(input.merchantId)
      )
        throw new Error('Primary card funding details are incomplete.');
      const result = await client.recover({
        merchantId: input.merchantId,
        userId,
        reference: input.reference,
      });
      if (!input.refs.isMountedRef.current) return;
      const requireSameAccount = () => {
        if (useAuthStore.getState().user?.id !== userId)
          throw new Error('The funding account changed.');
      };
      requireSameAccount();
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
      if (!input.refs.isMountedRef.current) return;
      requireSameAccount();
      input.setPaymentStatus('success');
      input.scheduleDelayedNavigation(() => {
        if (useAuthStore.getState().user?.id === userId)
          router.replace(getWalletReturnHref(result.returnTo));
      });
    } catch {
      if (!input.refs.isMountedRef.current) return;
      input.refs.paymentCompletionStartedRef.current = false;
      input.setPaymentStatus('error');
      input.setErrorMessage(
        'Could not check your funding status. This does not mean your card charge failed. Your operation is saved. Do not pay again; check its status later.'
      );
    }
  })();
}
