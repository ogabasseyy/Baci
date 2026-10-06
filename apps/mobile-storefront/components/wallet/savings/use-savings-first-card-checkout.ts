import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { startSavingsFirstCardCheckout } from '@/lib/savings-first-card-checkout';
import {
  recordSavingsFirstCardCheckoutState,
  type SavingsFirstCardCheckoutSnapshot,
  type SavingsFirstCardScope,
  saveSavingsFirstCardCheckoutSnapshot,
} from '@/lib/savings-first-card-checkout-snapshot';
import type { SavingsFirstCardCheckoutStatus } from '@/schemas/savings-first-card-checkout';
import { initializeSavingsFirstCardCheckout } from './initialize-savings-first-card-checkout';
import { openSavedFirstCardCheckout } from './open-saved-first-card-checkout';
import { savingsFirstCardStatusMessage } from './refresh-savings-first-card-status';
import { runSavingsFirstCardStatusRefresh } from './run-savings-first-card-status-refresh';
import { safeRemainingKobo } from './safe-remaining-kobo';
import { savingsCardContributionUtils as money } from './savings-card-contribution-utils';

type Input = {
  amount: string;
  goalId: string;
  merchantId: string;
  onAmountChange: (amount: string) => void;
  onCompleted?: () => Promise<unknown>;
  onRefreshWallet?: () => Promise<unknown>;
  remainingAmount: number;
  userId: string;
};

export function useSavingsFirstCardCheckout({
  amount,
  goalId,
  merchantId,
  onAmountChange,
  onCompleted,
  onRefreshWallet,
  remainingAmount,
  userId,
}: Input) {
  const [enabled, setEnabled] = useState(false);
  const [maximumAmountKobo, setMaximumAmountKobo] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [snapshot, setSnapshot] =
    useState<SavingsFirstCardCheckoutSnapshot | null>(null);
  const [status, setStatus] = useState<SavingsFirstCardCheckoutStatus | null>(
    null
  );
  const [message, setMessage] = useState('');
  const [allowRetry, setAllowRetry] = useState(false);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const busyRef = useRef(false);
  const activeRef = useRef(0);
  const statusRequestRef = useRef<Promise<void> | null>(null);
  const amountChangeRef = useRef(onAmountChange);
  const refreshWalletRef = useRef(onRefreshWallet);
  const onCompletedRef = useRef(onCompleted);
  amountChangeRef.current = onAmountChange;
  refreshWalletRef.current = onRefreshWallet;
  onCompletedRef.current = onCompleted;
  const scope: SavingsFirstCardScope = { userId, merchantId, goalId };
  const scopeKey = JSON.stringify([userId, merchantId, goalId]);
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;
  const isCurrentRef = useRef<(key: string, activation: number) => boolean>(
    () => false
  );
  isCurrentRef.current = (key, activation) =>
    activeRef.current === activation && key === scopeKeyRef.current;
  const amountKobo = money.amountToKobo(amount);
  const limitKobo = Math.min(
    maximumAmountKobo,
    safeRemainingKobo(remainingAmount)
  );
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const refreshStatusRef = useRef<
    (
      value?: SavingsFirstCardCheckoutSnapshot,
      requestScopeKey?: string,
      activation?: number,
      requestScope?: SavingsFirstCardScope
    ) => Promise<void>
  >(async () => undefined);

  refreshStatusRef.current = async (
    value = snapshotRef.current ?? undefined,
    requestScopeKey = scopeKey,
    activation = activeRef.current,
    requestScope = scope
  ) => {
    if (!value) return;
    await runSavingsFirstCardStatusRefresh({
      activation,
      isCurrent: (key, currentActivation) =>
        isCurrentRef.current(key, currentActivation),
      onCompleted: () => onCompletedRef.current?.(),
      refreshWallet: () => refreshWalletRef.current?.(),
      requestScope,
      requestScopeKey,
      setAllowRetry,
      setMessage,
      setEnabled,
      setMaximumAmountKobo,
      setSnapshot,
      setStatus,
      snapshot: value,
      statusRequestRef,
    });
  };
  useEffect(() => {
    const activation = activeRef.current + 1;
    activeRef.current = activation;
    const requestScopeKey = scopeKey;
    const requestScope = { userId, merchantId, goalId };
    const controller = new AbortController();
    busyRef.current = false;
    setBusy(false);
    setEnabled(false);
    setLoading(true);
    setSnapshot(null);
    setStatus(null);
    setMessage('');
    setAllowRetry(false);
    setReviewing(false);
    void initializeSavingsFirstCardCheckout({
      amountChange: (value) => amountChangeRef.current(value),
      activation,
      isCurrent: (key, currentActivation) =>
        isCurrentRef.current(key, currentActivation),
      refreshStatus: (value, key, currentActivation, currentScope) =>
        refreshStatusRef.current(value, key, currentActivation, currentScope),
      requestScope,
      requestScopeKey,
      setAllowRetry,
      setEnabled,
      setLoading,
      setMaximumAmountKobo,
      setMessage,
      setRecoveryBlocked,
      setSnapshot,
      setStatus,
      signal: controller.signal,
    });
    return () => {
      controller.abort();
      if (activeRef.current === activation) activeRef.current += 1;
      statusRequestRef.current = null;
    };
  }, [goalId, merchantId, scopeKey, userId]);

  useEffect(() => {
    let wasAway = AppState.currentState !== 'active';
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        wasAway = true;
      } else if (wasAway) {
        wasAway = false;
        void refreshStatusRef.current();
      }
    });
    return () => subscription.remove();
  }, []);

  const openCheckout = async (
    value: SavingsFirstCardCheckoutSnapshot,
    requestScopeKey: string,
    activation: number,
    requestScope: SavingsFirstCardScope
  ) => {
    await openSavedFirstCardCheckout({
      activation,
      isCurrent: (key, currentActivation) =>
        isCurrentRef.current(key, currentActivation),
      onClosed: (snapshotValue, key, currentActivation, scopeValue) =>
        refreshStatusRef.current(
          snapshotValue,
          key,
          currentActivation,
          scopeValue
        ),
      onUnavailable: () =>
        setMessage(
          'Checkout closed or unavailable. Payment status is being checked.'
        ),
      requestScope,
      requestScopeKey,
      snapshot: value,
    });
  };

  const startOrResume = async () => {
    const current = snapshotRef.current;
    if (
      busyRef.current ||
      (!current && (!enabled || !amountKobo || amountKobo > limitKobo))
    )
      return;
    const requestAmount = current?.amountKobo ?? amountKobo;
    if (!requestAmount) return;
    busyRef.current = true;
    setBusy(true);
    setAllowRetry(false);
    setMessage('');
    const activation = activeRef.current;
    const requestScopeKey = scopeKey;
    try {
      if (current?.intentId) {
        if (current.status === 'ready')
          await openCheckout(current, requestScopeKey, activation, scope);
        else await refreshStatusRef.current(current);
        return;
      }
      const saved =
        current ??
        (await saveSavingsFirstCardCheckoutSnapshot(scope, {
          goalId,
          amountKobo: requestAmount,
          consent: {
            version: 'prefunded-first-card-v1',
            oneTimeCharge: true,
            saveCard: true,
          },
        }));
      if (!isCurrentRef.current(requestScopeKey, activation)) return;
      setSnapshot(saved);
      const state = await startSavingsFirstCardCheckout({
        request: {
          goalId: saved.goalId,
          amountKobo: saved.amountKobo,
          idempotencyKey: saved.idempotencyKey,
          consent: saved.consent,
        },
      });
      if (
        state.goalId !== saved.goalId ||
        state.amountKobo !== saved.amountKobo
      )
        throw new Error('Checkout does not match the saved request.');
      const recorded = await recordSavingsFirstCardCheckoutState(
        scope,
        saved.idempotencyKey,
        state
      );
      if (!isCurrentRef.current(requestScopeKey, activation)) return;
      setSnapshot(recorded);
      setStatus(state.status);
      setReviewing(false);
      setMessage(savingsFirstCardStatusMessage(state.status));
      if (state.status === 'retired_unconfirmed') {
        await refreshStatusRef.current(
          recorded,
          requestScopeKey,
          activation,
          scope
        );
        return;
      }
      if (state.status === 'ready' && state.authorizationUrl) {
        await openCheckout(recorded, requestScopeKey, activation, scope);
        return;
      }
      setAllowRetry(false);
    } catch {
      if (!isCurrentRef.current(requestScopeKey, activation)) return;
      setMessage(
        'We could not confirm checkout. Retry uses the same saved request; no new charge is created.'
      );
      setAllowRetry(true);
    } finally {
      if (isCurrentRef.current(requestScopeKey, activation)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  return {
    allowRetry,
    amountKobo,
    begin: startOrResume,
    busy,
    canStart:
      !snapshot &&
      enabled &&
      !loading &&
      !busy &&
      Boolean(amountKobo && amountKobo <= limitKobo),
    enabled,
    limitKobo,
    loading,
    message,
    recoveryBlocked,
    refreshStatus: () => refreshStatusRef.current(),
    reviewing,
    setReviewing,
    snapshot,
    status,
  };
}
