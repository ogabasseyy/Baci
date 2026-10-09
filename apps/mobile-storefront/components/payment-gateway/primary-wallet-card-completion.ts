import { router } from 'expo-router';
import { createPrimaryWalletCardFundingClient } from '@/lib/primary-wallet-card';
import { useAuthStore } from '@/stores/auth-store';
import type { beginWalletTopUpCompletion } from './payment-gateway-completions';
import {
  getWalletReturnHref,
  WALLET_QUERY_KEY,
} from './payment-gateway-controller.helpers';

const client = createPrimaryWalletCardFundingClient();

const TERMINAL_DIRECTIVE_COPY =
  'This card checkout was cancelled before payment. No money moved. Start a new funding to try again.';
// A dropped persisted record only proves the device lost the operation —
// the server may still hold it (e.g. corrupt-record eviction after
// payment). Never claim no money moved here: starting a new funding
// re-adopts any surviving server operation, so nothing is lost either way.
const DROPPED_DIRECTIVE_COPY =
  'We could not find this funding on this device. Start a new funding to try again — any completed checkout will still be found and credited.';

export function beginPrimaryWalletCardCompletion(
  input: Parameters<typeof beginWalletTopUpCompletion>[0]
) {
  if (input.refs.paymentCompletionStartedRef.current) return;
  input.refs.paymentCompletionStartedRef.current = true;
  input.clearPendingLoadTimeout();
  input.setPaymentStatus('processing');
  // A new run has verified nothing yet: clear the previously confirmed
  // reference and terminal directive so a stale value can never display
  // if this run fails before recovering.
  input.setConfirmedOperationReference?.(null);
  input.setTerminalDirective?.(null);
  void (async () => {
    let failureCause:
      | 'incomplete_details'
      | 'account_changed'
      | 'operation_dropped'
      | 'recovery_unconfirmed' = 'recovery_unconfirmed';
    try {
      const userId = useAuthStore.getState().user?.id;
      // Recovery authority is the scoped persisted operation plus the
      // callback reference plus server status — deliberately not the
      // volatile capability cache. The cache is empty after an app
      // restart, so gating here would reject a valid server-enabled
      // non-pilot recovery (and its retries) before the persisted
      // operation could be verified. Merchants without primary simply
      // have no persisted operation, so recover() rejects the same way.
      if (
        !userId ||
        !input.merchantId ||
        !input.reference ||
        input.gateway !== 'paystack'
      ) {
        failureCause = 'incomplete_details';
        throw new Error('Primary card funding details are incomplete.');
      }
      const result = await client.recover({
        merchantId: input.merchantId,
        userId,
        reference: input.reference,
      });
      // Recover validated the callback reference against the persisted
      // operation and the server answered: this reference is confirmed,
      // unlike the raw URL parameter.
      input.setConfirmedOperationReference?.(result.reference);
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
        input.setErrorMessage(TERMINAL_DIRECTIVE_COPY);
        input.setTerminalDirective?.(TERMINAL_DIRECTIVE_COPY);
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
      // A dropped operation (abandoned terminal state removes the
      // persisted record) can never succeed on re-check: direct a new
      // funding instead of claiming an operation is retained. The scope
      // must be valid for the re-read to mean anything; without a
      // merchant the read would throw and coerce to 'unknown', so skip it
      // and keep the generic retained-operation message.
      if (failureCause === 'recovery_unconfirmed' && input.merchantId) {
        const retained = await client
          .readPending({
            merchantId: input.merchantId,
            userId: useAuthStore.getState().user?.id ?? '',
          })
          .catch(() => 'unknown' as const);
        if (retained === null) failureCause = 'operation_dropped';
      }
      // Redacted cause only: the error itself may carry provider or
      // account details, so log the classification, never the value.
      console.warn(`[primary-wallet-card] completion failed: ${failureCause}`);
      input.refs.paymentCompletionStartedRef.current = false;
      if (!input.refs.isMountedRef.current) return;
      input.setPaymentStatus('error');
      if (failureCause === 'operation_dropped') {
        input.setErrorMessage(DROPPED_DIRECTIVE_COPY);
        input.setTerminalDirective?.(DROPPED_DIRECTIVE_COPY);
      } else
        input.setErrorMessage(
          'Could not check your funding status. This does not mean your card charge failed. Your operation is saved. Do not pay again; check its status later.'
        );
    }
  })();
}
