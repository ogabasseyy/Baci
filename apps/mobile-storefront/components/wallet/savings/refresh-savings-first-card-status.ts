import { refreshSavingsFirstCardCheckout } from '@/lib/savings-first-card-checkout';
import {
  recordSavingsFirstCardCheckoutState,
  type SavingsFirstCardCheckoutSnapshot,
  type SavingsFirstCardScope,
} from '@/lib/savings-first-card-checkout-snapshot';
import type { SavingsFirstCardCheckoutStatus } from '@/schemas/savings-first-card-checkout';

export function savingsFirstCardStatusMessage(
  status: SavingsFirstCardCheckoutStatus
) {
  if (status === 'completed')
    return 'Payment confirmed. Your wallet is refreshing.';
  if (status === 'retired_unconfirmed')
    return 'This old checkout was closed for review. You may explicitly start a new payment.';
  if (status === 'reconciliation_required')
    return 'This payment needs review. Do not start another charge.';
  if (status === 'pending' || status === 'funding_pending')
    return 'Payment is pending confirmation. Do not start another charge.';
  if (status === 'ready')
    return 'Checkout is not confirmed yet. Continue checkout or check status.';
  return 'Checkout is being reconciled. Check status before taking further action.';
}

export async function refreshSavedSavingsFirstCardStatus({
  activation,
  clearRetiredSnapshot,
  isCurrent,
  onCompleted,
  refreshWallet,
  refreshCapability,
  requestScope,
  requestScopeKey,
  setAllowRetry,
  setMessage,
  setSnapshot,
  setStatus,
  snapshot,
  statusRequestRef,
}: {
  activation: number;
  clearRetiredSnapshot: (
    scope: SavingsFirstCardScope,
    expectedKey: string,
    expectedIntentId: string
  ) => Promise<void>;
  isCurrent: (key: string, activation: number) => boolean;
  onCompleted?: () => Promise<unknown> | undefined;
  refreshWallet: () => Promise<unknown> | undefined;
  refreshCapability: () => Promise<void>;
  requestScope: SavingsFirstCardScope;
  requestScopeKey: string;
  setAllowRetry: (value: boolean) => void;
  setMessage: (value: string) => void;
  setSnapshot: (value: SavingsFirstCardCheckoutSnapshot | null) => void;
  setStatus: (value: SavingsFirstCardCheckoutStatus) => void;
  snapshot: SavingsFirstCardCheckoutSnapshot;
  statusRequestRef: { current: Promise<void> | null };
}) {
  if (!snapshot.intentId || !isCurrent(requestScopeKey, activation)) return;
  if (statusRequestRef.current) return await statusRequestRef.current;
  const task = (async () => {
    try {
      const state = await refreshSavingsFirstCardCheckout({
        selection: { intentId: snapshot.intentId, goalId: requestScope.goalId },
      });
      if (!isCurrent(requestScopeKey, activation)) return;
      if (
        state.intentId !== snapshot.intentId ||
        state.goalId !== snapshot.goalId ||
        state.amountKobo !== snapshot.amountKobo
      )
        throw new Error('Checkout status does not match this request.');
      if (state.status === 'retired_unconfirmed') {
        await clearRetiredSnapshot(
          requestScope,
          snapshot.idempotencyKey,
          snapshot.intentId
        );
        if (!isCurrent(requestScopeKey, activation)) return;
        setSnapshot(null);
        setStatus(state.status);
        setAllowRetry(false);
        setMessage(savingsFirstCardStatusMessage(state.status));
        await refreshCapability();
        return;
      }
      const updated = await recordSavingsFirstCardCheckoutState(
        requestScope,
        snapshot.idempotencyKey,
        state
      );
      if (!isCurrent(requestScopeKey, activation)) return;
      setSnapshot(updated);
      setStatus(state.status);
      setAllowRetry(false);
      setMessage(savingsFirstCardStatusMessage(state.status));
      if (state.status === 'completed') {
        try {
          await refreshWallet();
        } catch {
          if (!isCurrent(requestScopeKey, activation)) return;
        }
        if (!isCurrent(requestScopeKey, activation)) return;
        try {
          await onCompleted?.();
        } catch {
          if (!isCurrent(requestScopeKey, activation)) return;
        }
      }
    } catch {
      if (!isCurrent(requestScopeKey, activation)) return;
      setMessage(
        'Status is unavailable. Your saved request is unchanged. Check status before retrying.'
      );
      setAllowRetry(false);
    }
  })();
  statusRequestRef.current = task;
  try {
    await task;
  } finally {
    if (statusRequestRef.current === task) statusRequestRef.current = null;
  }
}
