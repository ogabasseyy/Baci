import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { PIGGYVEST_WALLET_SETUP as policy } from '@/config/piggyvest-wallet-setup';
import { isPrimaryWalletReviewRequired } from '@/lib/piggyvest-primary-capability';
import { piggyvestPrimaryWalletApi as api } from '@/lib/piggyvest-primary-wallet';
import { PiggyvestPrimaryWalletSchemas } from '@/schemas/piggyvest-primary-wallet';
import { useAuthStore } from '@/stores/auth-store';
import {
  type PiggyvestWalletSetupSnapshot,
  piggyvestWalletSetupQuery,
} from './piggyvest-wallet-setup-query';

type Snapshot = PiggyvestWalletSetupSnapshot;
type Input = Parameters<typeof api.create>[0];

export function usePiggyvestWalletSetup(merchantId: string, userId: string) {
  const client = useQueryClient();
  const scope = `${merchantId}:${userId}`;
  const storageKey = `${policy.storagePrefix}${scope}`;
  const queryKey = ['piggyvest-wallet-setup', merchantId, userId];
  const [foreground, setForeground] = useState(
    AppState.currentState !== 'background' &&
      AppState.currentState !== 'inactive'
  );
  const [pollUntil, setPollUntil] = useState(
    Date.now() + policy.pollingWindowMs
  );
  const [delayed, setDelayed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewHold, setReviewHold] = useState(false);
  const submittingRef = useRef(false);
  const binding = useRef({ scope, active: true });
  if (binding.current.scope !== scope)
    binding.current = { scope, active: true };
  const query = useQuery({
    ...piggyvestWalletSetupQuery(client, merchantId, userId),
    enabled: foreground && !submitting,
    refetchOnMount: true,
    refetchOnReconnect: 'always',
    refetchInterval: (current) =>
      foreground &&
      !submitting &&
      Date.now() < pollUntil &&
      current.state.data?.attempted &&
      !current.state.data.account
        ? policy.pollingIntervalMs
        : false,
    retry: 1,
    retryDelay: 1000,
  });
  const reviewRequired =
    reviewHold || isPrimaryWalletReviewRequired(query.error);
  const successfulStatus = query.isSuccess && query.error === null;
  const recoverable =
    successfulStatus && !reviewRequired && query.data?.recoverable === true;

  useEffect(() => {
    const ticket = binding.current;
    ticket.active = true;
    setReviewHold(false);
    setSubmitting(false);
    submittingRef.current = false;
    const resume = () => {
      setPollUntil(Date.now() + policy.pollingWindowMs);
      setDelayed(false);
      void client.invalidateQueries({
        queryKey: ['piggyvest-wallet-setup', merchantId, userId],
        exact: true,
      });
    };
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state === 'active') resume();
    });
    const unsubscribe = onlineManager.subscribe((online) => {
      if (online && AppState.currentState === 'active') resume();
    });
    return () => {
      ticket.active = false;
      subscription.remove();
      unsubscribe();
    };
  }, [client, merchantId, userId]);

  useEffect(() => {
    setDelayed(false);
    if (!foreground || !query.data?.attempted || query.data.account) return;
    const timer = setTimeout(
      () => setDelayed(true),
      Math.max(0, pollUntil - Date.now())
    );
    return () => clearTimeout(timer);
  }, [foreground, pollUntil, query.data?.attempted, query.data?.account]);

  function refresh() {
    setPollUntil(Date.now() + policy.pollingWindowMs);
    setDelayed(false);
    if (!submittingRef.current) void query.refetch();
  }

  async function submit(input: Input, recoveryRetry = false) {
    const attempted = query.data?.attempted === true;
    if (
      submittingRef.current ||
      !successfulStatus ||
      reviewRequired ||
      query.data?.account ||
      (attempted && (!recoveryRetry || !recoverable)) ||
      (!attempted && query.data?.provisioningStatus !== 'not_started')
    )
      return;
    const parsed = PiggyvestPrimaryWalletSchemas.create.parse(input);
    if (
      parsed.merchantId !== merchantId ||
      useAuthStore.getState().user?.id !== userId
    ) {
      throw new Error('The signed-in account changed.');
    }
    const ticket = binding.current;
    const current = () =>
      ticket.active &&
      binding.current === ticket &&
      useAuthStore.getState().user?.id === userId;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await client.cancelQueries({ queryKey, exact: true });
      if (!current()) return;
      if (recoveryRetry) {
        // Cached GET eligibility can age between rendering the form and submit.
        // Recheck the scoped server state immediately before the guarded POST.
        let fresh: Awaited<ReturnType<typeof api.read>>;
        try {
          fresh = await api.read(merchantId, userId);
        } catch (error) {
          if (current()) {
            if (isPrimaryWalletReviewRequired(error)) setReviewHold(true);
            client.setQueryData<Snapshot>(queryKey, (snapshot) =>
              snapshot ? { ...snapshot, recoverable: false } : snapshot
            );
          }
          throw error;
        }
        if (!current()) return;
        if (
          fresh.account ||
          fresh.provisioningStatus !== 'pending' ||
          fresh.recoverable !== true
        ) {
          if (fresh.provisioningStatus === 'pending') {
            client.setQueryData<Snapshot>(queryKey, (snapshot) =>
              snapshot
                ? {
                    ...snapshot,
                    ...fresh,
                    attempted: true,
                    completedSetup: false,
                  }
                : snapshot
            );
          } else {
            client.setQueryData<Snapshot>(queryKey, {
              ...fresh,
              attempted: false,
              completedSetup: false,
            });
          }
          throw Object.assign(
            new Error('Wallet recovery is no longer available.'),
            {
              code: 'RECOVERY_NOT_AVAILABLE',
            }
          );
        }
      }
      await AsyncStorage.setItem(storageKey, 'pending');
      if (!current()) return;
      let snapshot: Snapshot;
      try {
        const result = await api.create(parsed, userId);
        snapshot = {
          ...result,
          attempted: !result.account,
          completedSetup: !!result.account,
        };
      } catch (error) {
        if (current() && isPrimaryWalletReviewRequired(error)) {
          setReviewHold(true);
          client.setQueryData<Snapshot>(queryKey, (current) =>
            current ? { ...current, recoverable: false } : current
          );
        }
        const code =
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : undefined;
        if (typeof code === 'string' && policy.rejectedCodes.has(code)) {
          await AsyncStorage.removeItem(storageKey);
          throw error;
        }
        snapshot = {
          account: null,
          attempted: true,
          completedSetup: false,
          recoverable: false,
          provisioningStatus: 'pending',
          requiresConsent: false,
        };
      }
      if (!current()) return;
      if (snapshot.account)
        await AsyncStorage.removeItem(storageKey).catch(() => undefined);
      if (!current()) return;
      client.setQueryData(queryKey, snapshot);
      setPollUntil(Date.now() + policy.pollingWindowMs);
      setDelayed(false);
    } finally {
      if (current()) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  }

  return {
    scopeKey: scope,
    account: query.data?.account ?? null,
    justCreated: query.data?.completedSetup === true,
    acknowledgeReady: () =>
      client.setQueryData<Snapshot>(queryKey, (snapshot) =>
        snapshot ? { ...snapshot, completedSetup: false } : snapshot
      ),
    state: query.data?.account
      ? ('ready' as const)
      : query.data?.attempted
        ? ('processing' as const)
        : query.data
          ? ('not_started' as const)
          : query.isError
            ? ('unavailable' as const)
            : ('checking' as const),
    recoverable,
    reviewRequired,
    hasCheckError: query.isError,
    isChecking: query.isFetching,
    delayed,
    submitting,
    refresh,
    submit: (input: Input) => submit(input),
    recover: (input: Input) => submit(input, true),
  };
}
