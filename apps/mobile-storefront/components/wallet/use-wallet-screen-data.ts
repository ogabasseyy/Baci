import { useIsFocused } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useWallet } from '@/hooks/use-wallet';
import { useWalletNumberRefresh } from '@/hooks/use-wallet-number-refresh';
import { CONFIG } from '@/lib/config';
import { useAuthStore } from '@/stores/auth-store';
import type { WalletRefreshState } from './WalletRefreshNotice';

async function refetchAndReset<
  TArgs extends unknown[],
  TResult extends { isError: boolean },
>(
  refetch: (...args: TArgs) => Promise<TResult>,
  reset: () => void,
  shouldReset: () => boolean,
  ...args: TArgs
) {
  const result = await refetch(...args);
  if (!result.isError && shouldReset()) reset();
  return result;
}

export function useWalletScreenData() {
  const query = useWallet({
    cachePolicy: 'display',
    navigationRefresh: 'numbers',
    progressive: true,
  });
  const numbers = useWalletNumberRefresh();
  const focused = useIsFocused();
  const { customer, merchantId, user } = useAuthStore(
    useShallow((state) => ({
      customer: state.customer,
      merchantId: state.merchantId,
      user: state.user,
    }))
  );
  const activeMerchantId = merchantId || CONFIG.MERCHANT_ID;
  const customerId = customer?.id;
  const userId = user?.id;
  const identityAgreed =
    !!userId && (!customer?.user_id || customer.user_id === userId);
  const hasSnapshot = !!query.data;
  const scope = `${activeMerchantId}:${customerId ?? ''}:${userId ?? ''}`;
  const scopeGeneration = useRef({ scope, value: 0 });
  if (scopeGeneration.current.scope !== scope) {
    scopeGeneration.current = {
      scope,
      value: scopeGeneration.current.value + 1,
    };
  }
  const refreshStateRef = useRef({
    scope,
    generation: scopeGeneration.current.value,
    isPending: numbers.isPending,
  });
  refreshStateRef.current = {
    scope,
    generation: scopeGeneration.current.value,
    isPending: numbers.isPending,
  };
  const numericRefreshCount = useRef(0);
  const resetNumberRefresh = numbers.reset;
  const refetchWallet = (...args: Parameters<typeof query.refetch>) => {
    const generation = scopeGeneration.current.value;
    return refetchAndReset(
      query.refetch,
      resetNumberRefresh,
      () => {
        const current = refreshStateRef.current;
        return (
          current.scope === scope &&
          current.generation === generation &&
          !current.isPending &&
          numericRefreshCount.current === 0
        );
      },
      ...args
    );
  };
  const lastObservation = useRef<{
    scope: string;
    hasSnapshot: boolean;
  } | null>(null);
  const resumedWhileLoading = useRef(false);
  const { refetch } = query;
  const { mutateAsync } = numbers;
  const effectScopeGeneration = scopeGeneration.current.value;
  useEffect(() => {
    let active = true;
    let running = false;
    let pending = false;
    const isCurrent = () => active && focused && identityAgreed;
    const requestRefresh = async () => {
      if (!isCurrent() || !hasSnapshot || !userId) return;
      if (running) {
        pending = true;
        return;
      }
      running = true;
      numericRefreshCount.current++;
      try {
        do {
          pending = false;
          await mutateAsync({
            customerId: customerId ?? null,
            merchantId: activeMerchantId,
            userId,
            isCurrent,
            includeTransactions: true,
            refetchFull: () =>
              refetchAndReset(
                refetch,
                resetNumberRefresh,
                () => {
                  const current = refreshStateRef.current;
                  return (
                    current.scope === scope &&
                    current.generation === effectScopeGeneration &&
                    !current.isPending &&
                    numericRefreshCount.current === 0
                  );
                },
                { cancelRefetch: false, throwOnError: true }
              ),
          });
        } while (isCurrent() && pending);
      } catch {
        pending = false;
      } finally {
        running = false;
        numericRefreshCount.current--;
      }
    };
    const previous = lastObservation.current;
    const justLoaded =
      previous?.scope === scope && !previous.hasSnapshot && hasSnapshot;
    lastObservation.current = { scope, hasSnapshot };
    if (!justLoaded || resumedWhileLoading.current) void requestRefresh();
    if (hasSnapshot) resumedWhileLoading.current = false;
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (state) => {
      const resumed = state === 'active' && previousState !== 'active';
      previousState = state;
      if (resumed) {
        if (!hasSnapshot) resumedWhileLoading.current = true;
        void requestRefresh();
      }
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [
    activeMerchantId,
    customerId,
    userId,
    focused,
    identityAgreed,
    hasSnapshot,
    mutateAsync,
    refetch,
    resetNumberRefresh,
    effectScopeGeneration,
    scope,
  ]);

  const refreshState: WalletRefreshState | undefined =
    query.fetchStatus === 'paused' || numbers.isPaused
      ? 'offline'
      : query.isRefetching || numbers.isPending
        ? 'updating'
        : query.isError || numbers.isError
          ? 'error'
          : undefined;
  return { ...query, refetch: refetchWallet, refreshState };
}
