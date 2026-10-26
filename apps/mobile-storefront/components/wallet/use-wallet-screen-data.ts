import { useIsFocused } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useWallet } from '@/hooks/use-wallet';
import { useWalletNumberRefresh } from '@/hooks/use-wallet-number-refresh';
import { CONFIG } from '@/lib/config';
import { useAuthStore } from '@/stores/auth-store';
import type { WalletRefreshState } from './WalletRefreshNotice';

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
  const lastObservation = useRef<{
    scope: string;
    hasSnapshot: boolean;
  } | null>(null);
  const resumedWhileLoading = useRef(false);
  const { refetch } = query;
  const { mutateAsync } = numbers;
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
              refetch({ cancelRefetch: false, throwOnError: true }),
          });
        } while (isCurrent() && pending);
      } catch {
        pending = false;
      } finally {
        running = false;
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
  return { ...query, refreshState };
}
