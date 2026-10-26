import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { classifyWalletChange } from './classify-wallet-change';
import { useWalletNumberRefresh } from './use-wallet-number-refresh';
import type { WalletQueryData, WalletQueryKey } from './wallet-query';

const REALTIME_REFRESH_WINDOW_MS = 250;

export function useWalletRealtime(scope: {
  customerId?: string;
  merchantId: string;
  userId?: string;
  key: WalletQueryKey | readonly ['wallet', 'disabled'];
  numbersOnly: boolean;
  enabled: boolean;
  walletId?: string;
  updatedAt?: number;
}) {
  const client = useQueryClient();
  const refresh = useWalletNumberRefresh();
  const { mutateAsync, reset } = refresh;
  const {
    customerId,
    merchantId,
    userId,
    key,
    numbersOnly,
    enabled,
    walletId,
  } = scope;
  const keyId = JSON.stringify(key);
  const resetToken = `${keyId}:${scope.updatedAt ?? 0}`;
  const previousReset = useRef<string | null>(null);
  useEffect(() => {
    if (previousReset.current === resetToken) return;
    previousReset.current = resetToken;
    reset();
  }, [resetToken, reset]);
  useEffect(() => {
    if (!enabled) return;
    // A numbers-only refresh preserves the full snapshot's age. Observe its
    // successful write separately so a recovered realtime error can clear.
    return client.getQueryCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'success' &&
        JSON.stringify(event.query.queryKey) === keyId
      )
        reset();
    });
  }, [client, enabled, keyId, reset]);
  useEffect(() => {
    if (!enabled) return;
    const queryKey = JSON.parse(keyId) as WalletQueryKey;
    let active = true;
    let running = false;
    let pending: 'full' | 'numbers' | 'history' | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refetchFull = async () => {
      if (client.getQueryState(queryKey)?.fetchStatus === 'fetching')
        await client.refetchQueries(
          { queryKey, exact: true },
          { cancelRefetch: false, throwOnError: true }
        );
      if (active) await client.invalidateQueries({ queryKey, exact: false });
    };
    const run = async () => {
      timer = undefined;
      if (!active || running || !pending) return;
      const mode = pending;
      pending = undefined;
      running = true;
      try {
        if (mode === 'full' || !numbersOnly || !userId) await refetchFull();
        else
          await mutateAsync({
            customerId: customerId ?? null,
            merchantId,
            userId,
            isCurrent: () => active,
            refetchFull,
            includeTransactions: mode === 'history',
          });
      } catch {
        return;
      } finally {
        running = false;
        if (active && pending && timer === undefined)
          timer = setTimeout(() => void run(), REALTIME_REFRESH_WINDOW_MS);
      }
    };
    const receive = (
      table: string,
      payload: Parameters<typeof classifyWalletChange>[1]
    ) => {
      if (!active) return;
      const mode = classifyWalletChange(
        table,
        payload,
        client.getQueryData<WalletQueryData>(queryKey),
        { merchantId, customerId }
      );
      if (mode === 'ignore') return;
      if (pending !== 'full')
        pending = mode === 'full' || pending !== 'history' ? mode : pending;
      if (!running && timer === undefined)
        timer = setTimeout(() => void run(), REALTIME_REFRESH_WINDOW_MS);
    };
    let channel = supabase.channel(
      `wallet-hook-${merchantId}-${customerId ?? userId}-${Date.now()}`
    );
    if (customerId) {
      for (const table of [
        'customer_wallets',
        'customer_savings_goals',
        'customer_savings_contributions',
      ]) {
        channel = channel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table,
            filter: `customer_id=eq.${customerId}`,
          },
          (payload) => receive(table, payload)
        );
      }
      channel = channel.on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'customers',
          filter: `id=eq.${customerId}`,
        },
        (payload) => receive('customers', payload)
      );
    }
    if (walletId)
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'customer_wallet_transactions',
          filter: `wallet_id=eq.${walletId}`,
        },
        (payload) => receive('customer_wallet_transactions', payload)
      );
    if (userId)
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'customers',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => receive('customers', payload)
      );
    channel.subscribe();
    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [
    client,
    customerId,
    enabled,
    keyId,
    merchantId,
    mutateAsync,
    numbersOnly,
    userId,
    walletId,
  ]);
  return refresh;
}
