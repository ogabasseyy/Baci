import { useEffect, useRef, useState } from 'react';
import {
  type SavingsCardContributionSnapshot,
  saveSavingsCardContributionSnapshot,
} from '@/lib/savings-card-contribution-snapshot';
import { submitSavingsCardContribution } from '@/lib/savings-card-contributions';
import {
  initializeSavingsCardContribution,
  prepareNewSavingsCardContribution,
  refreshSavingsCardContributionMethods,
} from './savings-card-contribution-initialization';
import { readSavingsCardContributionStatus } from './savings-card-contribution-status';
import { savingsCardContributionUtils } from './savings-card-contribution-utils';
import type {
  UseSavingsCardContributionInput as Input,
  SavingsCardContributionOperation as Operation,
  SavingsCardContributionMethod as SavedMethod,
} from './use-savings-card-contribution.types';
export function useSavingsCardContribution({
  amount,
  goalId,
  merchantId,
  onAmountChange,
  onRefreshWallet,
  remainingAmount,
  userId,
}: Input) {
  const [methods, setMethods] = useState<SavedMethod[]>([]);
  const [selectedMethodId, setSelectedMethodId] = useState('');
  const [maximumAmountKobo, setMaximumAmountKobo] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [capabilityLoaded, setCapabilityLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] =
    useState<SavingsCardContributionSnapshot | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [allowRetry, setAllowRetry] = useState(false);
  const busyRef = useRef(false);
  const refreshWalletRef = useRef(onRefreshWallet);
  refreshWalletRef.current = onRefreshWallet;
  const amountChangeRef = useRef(onAmountChange);
  amountChangeRef.current = onAmountChange;
  const controllersRef = useRef(new Set<AbortController>());
  const activationRef = useRef(0);
  const scopeKey = JSON.stringify([userId, merchantId, goalId]);
  const amountKobo = savingsCardContributionUtils.amountToKobo(amount);
  const limitKobo = Math.min(
    maximumAmountKobo,
    Math.max(0, remainingAmount) * 100
  );
  const scopeKeyRef = useRef(scopeKey);
  const activeScopeRef = useRef<string | null>(null);
  scopeKeyRef.current = scopeKey;
  const currentScopeRef = useRef(
    (requestScopeKey: string, activation: number) =>
      activationRef.current === activation &&
      activeScopeRef.current === requestScopeKey &&
      scopeKeyRef.current === requestScopeKey
  );
  useEffect(() => {
    const controller = new AbortController();
    const requestScopeKey = scopeKey;
    const activation = ++activationRef.current;
    activeScopeRef.current = requestScopeKey;
    const scope = { userId, merchantId, goalId };
    busyRef.current = false;
    setBusy(false);
    const current = () =>
      !controller.signal.aborted &&
      currentScopeRef.current(requestScopeKey, activation);
    setMethods([]);
    setEnabled(false);
    setCapabilityLoaded(false);
    setLoading(true);
    setSnapshot(null);
    setOperation(null);
    setSelectedMethodId('');
    setReviewing(false);
    setMessage('');
    setAllowRetry(false);
    void initializeSavingsCardContribution({
      goalId,
      isCurrent: current,
      onAmountChange: (value) => amountChangeRef.current(value),
      refreshWallet: () => refreshWalletRef.current?.(),
      scope,
      setAllowRetry,
      setCapabilityLoaded,
      setEnabled,
      setLoading,
      setMaximumAmountKobo,
      setMessage,
      setMethods,
      setOperation,
      setSelectedMethodId,
      setSnapshot,
      signal: controller.signal,
    });
    return () => {
      controller.abort();
      if (activationRef.current === activation) activationRef.current += 1;
      if (activeScopeRef.current === requestScopeKey)
        activeScopeRef.current = null;
      controllersRef.current.forEach((request) => {
        request.abort();
      });
      controllersRef.current.clear();
    };
  }, [goalId, merchantId, scopeKey, userId]);
  const readStatus = (
    currentSnapshot = snapshot,
    allowBusy = false,
    activation = activationRef.current
  ) =>
    readSavingsCardContributionStatus({
      allowBusy,
      busyRef,
      controllers: controllersRef.current,
      expectedOperationId: operation?.operationId,
      goalId,
      isCurrent: () => currentScopeRef.current(scopeKey, activation),
      refreshWallet: () => refreshWalletRef.current?.(),
      setAllowRetry,
      setBusy,
      setMessage,
      setOperation,
      snapshot: currentSnapshot,
    });
  const sendSnapshot = async (
    currentSnapshot: SavingsCardContributionSnapshot,
    reserved = false,
    activation = activationRef.current
  ) => {
    if (busyRef.current && !reserved) return;
    const requestScopeKey = scopeKey;
    if (
      !currentScopeRef.current(requestScopeKey, activation) ||
      currentSnapshot.goalId !== goalId
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setAllowRetry(false);
    setMessage('');
    const controller = new AbortController();
    controllersRef.current.add(controller);
    try {
      await submitSavingsCardContribution({
        request: currentSnapshot,
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        !currentScopeRef.current(requestScopeKey, activation)
      )
        return;
      setReviewing(false);
      busyRef.current = false;
      setBusy(false);
      await readStatus(currentSnapshot, true, activation);
    } catch {
      if (
        !controller.signal.aborted &&
        currentScopeRef.current(requestScopeKey, activation)
      ) {
        setMessage(
          'We could not confirm the request. Your saved request is unchanged; retry uses the same key.'
        );
        setAllowRetry(true);
      }
    } finally {
      controllersRef.current.delete(controller);
      if (
        !controller.signal.aborted &&
        currentScopeRef.current(requestScopeKey, activation)
      ) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  const beginContribution = async () => {
    if (
      busyRef.current ||
      !enabled ||
      !selectedMethodId ||
      !amountKobo ||
      amountKobo > limitKobo
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setMessage('');
    const requestScopeKey = scopeKey;
    const activation = activationRef.current;
    try {
      const saved = await saveSavingsCardContributionSnapshot(
        { userId, merchantId, goalId },
        {
          goalId,
          savedMethodId: selectedMethodId,
          amountKobo,
          consent: { version: 'prefunded-card-v1', oneTimeCharge: true },
        }
      );
      if (!currentScopeRef.current(requestScopeKey, activation)) return;
      setSnapshot(saved);
      setReviewing(false);
      await sendSnapshot(saved, true, activation);
    } catch {
      if (currentScopeRef.current(requestScopeKey, activation))
        setMessage(
          'Unable to confirm a durable request. No card request was sent.'
        );
    } finally {
      if (currentScopeRef.current(requestScopeKey, activation)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  const beginNewContribution = async () => {
    if (
      !snapshot ||
      !operation ||
      busyRef.current ||
      (operation.status !== 'completed' &&
        operation.status !== 'collection_failed')
    )
      return;
    busyRef.current = true;
    setBusy(true);
    const requestScopeKey = scopeKey;
    const activation = activationRef.current;
    try {
      await prepareNewSavingsCardContribution({
        isCurrent: () => currentScopeRef.current(requestScopeKey, activation),
        onAmountChange: (value) => amountChangeRef.current(value),
        operationStatus: operation.status,
        scope: { userId, merchantId, goalId },
        setMessage,
        setOperation,
        setSelectedMethodId,
        setSnapshot,
        snapshot,
      });
    } finally {
      if (currentScopeRef.current(requestScopeKey, activation)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  const refreshMethods = () => {
    const activation = activationRef.current;
    return refreshSavingsCardContributionMethods({
      goalId,
      isCurrent: () => currentScopeRef.current(scopeKey, activation),
      setCapabilityLoaded,
      setEnabled,
      setMaximumAmountKobo,
      setMessage,
      setMethods,
    });
  };
  return {
    amountKobo,
    allowRetry,
    beginContribution,
    beginNewContribution,
    busy,
    capabilityLoaded,
    enabled,
    loading,
    maximumAmountKobo,
    message,
    methods,
    operation,
    readStatus,
    refreshMethods,
    retryContribution: () =>
      snapshot && sendSnapshot(snapshot, false, activationRef.current),
    reviewing,
    selectedMethodId,
    selectMethod: setSelectedMethodId,
    setMessage,
    setReviewing,
    snapshot,
    limitKobo,
    canStartNew: Boolean(
      snapshot &&
        operation &&
        (operation.status === 'completed' ||
          operation.status === 'collection_failed')
    ),
  };
}
