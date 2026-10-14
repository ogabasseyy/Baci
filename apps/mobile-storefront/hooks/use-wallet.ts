import type { RealtimeChannel } from '@supabase/supabase-js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CONFIG } from '@/lib/config';
import { supabase } from '@/lib/supabase';
import { resolveWalletReadOwnerId } from '@/lib/utility-owner-ids';
import { createWalletFundingAccount } from '@/lib/wallet-funding-account';
import { useAuthStore } from '@/stores/auth-store';
import { fetchWalletData } from './wallet-data';
import { walletKeys } from './wallet-query';

export { useRedeemPoints } from './use-redeem-points';
export type { WalletQueryData } from './wallet-query';
export { walletKeys } from './wallet-query';

// ============================================
// HOOKS
// ============================================

const SAVINGS_INVALIDATION_DEBOUNCE_MS = 250;
const WALLET_STRICT_STALE_TIME_MS = 30_000;
const WALLET_STRICT_GC_TIME_MS = 5 * 60_000;
const WALLET_DISPLAY_STALE_TIME_MS = 2 * 60_000;
const WALLET_DISPLAY_GC_TIME_MS = 30 * 60_000;

interface UseWalletOptions {
  cachePolicy?: 'strict' | 'display';
}

function resolveWalletCachePolicy(
  cachePolicy: UseWalletOptions['cachePolicy']
) {
  if (cachePolicy === 'display') {
    return {
      gcTime: WALLET_DISPLAY_GC_TIME_MS,
      staleTime: WALLET_DISPLAY_STALE_TIME_MS,
    };
  }

  return {
    gcTime: WALLET_STRICT_GC_TIME_MS,
    staleTime: WALLET_STRICT_STALE_TIME_MS,
  };
}

/**
 * Main wallet data hook with React Query
 */
export function useWallet(options: UseWalletOptions = {}) {
  const queryClient = useQueryClient();
  const cachePolicy = resolveWalletCachePolicy(options.cachePolicy);
  const { customer, merchantId, user } = useAuthStore(
    useShallow((state) => ({
      customer: state.customer,
      merchantId: state.merchantId,
      user: state.user,
    }))
  );
  const channelRef = useRef<RealtimeChannel | null>(null);
  const savingsInvalidationTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const walletOwnerId = resolveWalletReadOwnerId(customer?.id, user?.id);
  const activeMerchantId = merchantId || CONFIG.MERCHANT_ID;
  // Both identities present but disagreeing (customer row linked to a
  // different auth user) means a switch is mid-flight: hold the query
  // — including the primary probe — until they agree, so the load can
  // never mix one identity's wallet with another's funding account.
  const identityAgreed =
    !customer?.id || !user?.id || (customer.user_id ?? user.id) === user.id;
  const walletQueryKey =
    walletOwnerId && activeMerchantId
      ? walletKeys.data({
          merchantId: activeMerchantId,
          ownerId: walletOwnerId,
          userId: user?.id ?? undefined,
        })
      : (['wallet', 'disabled'] as const);

  // Destructure so TanStack Query's tracked-property optimization only
  // subscribes to the fields consumers actually use.
  const {
    data,
    error,
    fetchStatus,
    isError,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: walletQueryKey,
    queryFn: () =>
      fetchWalletData(customer?.id ?? null, activeMerchantId, user?.id ?? null),
    enabled: !!walletOwnerId && !!activeMerchantId && identityAgreed,
    staleTime: cachePolicy.staleTime,
    gcTime: cachePolicy.gcTime,
  });

  // Real-time sync
  // 2026 Critical Fix: Prevent channel race condition on rapid mount/unmount
  useEffect(() => {
    // Equivalent to the old both-absent guard (the helper returns null
    // exactly then), and narrows the nullable owner for the key below.
    if (!walletOwnerId) return;

    // Cleanup any existing channel first (prevent duplicates)
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    let isMounted = true;
    const channelName = `wallet-hook-${customer?.id ?? user?.id}-${Date.now()}`;
    const activeWalletQueryKey = walletKeys.data({
      merchantId: activeMerchantId,
      ownerId: walletOwnerId,
      userId: user?.id ?? undefined,
    });
    const invalidateWalletData = () => {
      if (isMounted) {
        queryClient.invalidateQueries({
          queryKey: activeWalletQueryKey,
          exact: false,
        });
      }
    };
    const debouncedSavingsInvalidation = () => {
      if (!isMounted) {
        return;
      }
      if (savingsInvalidationTimerRef.current) {
        clearTimeout(savingsInvalidationTimerRef.current);
      }
      savingsInvalidationTimerRef.current = setTimeout(() => {
        savingsInvalidationTimerRef.current = null;
        invalidateWalletData();
      }, SAVINGS_INVALIDATION_DEBOUNCE_MS);
    };

    const customerId = customer?.id;
    let channel = supabase.channel(channelName);
    if (customerId) {
      channel = channel
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'customer_wallets',
            filter: `customer_id=eq.${customerId}`,
          },
          () => {
            // Only invalidate if still mounted
            invalidateWalletData();
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'customers',
            filter: `id=eq.${customerId}`,
          },
          () => {
            invalidateWalletData();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'customer_savings_goals',
            filter: `customer_id=eq.${customerId}`,
          },
          () => {
            debouncedSavingsInvalidation();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'customer_savings_contributions',
            filter: `customer_id=eq.${customerId}`,
          },
          () => {
            debouncedSavingsInvalidation();
          }
        );
    }
    // User-only sessions have no customer rows to watch, but the
    // customer row may be created/linked at any moment: watch the
    // customers table by auth user so the wallet refreshes then.
    if (user?.id) {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'customers',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          invalidateWalletData();
        }
      );
    }
    channel.subscribe();

    channelRef.current = channel;

    return () => {
      isMounted = false;
      if (savingsInvalidationTimerRef.current) {
        clearTimeout(savingsInvalidationTimerRef.current);
        savingsInvalidationTimerRef.current = null;
      }
      if (channelRef.current) {
        // Use removeChannel for synchronous cleanup
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [activeMerchantId, customer?.id, user?.id, queryClient, walletOwnerId]);

  return {
    data,
    error,
    fetchStatus,
    // Live reader (Codex R78 6sN80p): purchase closures capture the
    // render-time balance before the settlement-gate await; a refetch
    // completing mid-await leaves that snapshot stale while fresh
    // data sits in the cache. Read the cache imperatively instead.
    getWalletBalance: () =>
      queryClient.getQueryData<typeof data>(walletQueryKey)?.wallet.balance ??
      0,
    isError,
    // Live reader (Codex R75 6r486a): readiness gates call this AFTER
    // the settlement-gate await, when the render-time isRefetching
    // snapshot is stale. Reads the cache imperatively, so a refetch
    // starting mid-await still blocks. exact: the key is owner-scoped.
    isFetchingNow: () =>
      queryClient.isFetching({ queryKey: walletQueryKey, exact: true }) > 0,
    isLoading,
    isRefetching,
    refetch,
  };
}

export function useCreateWalletFundingAccount() {
  const queryClient = useQueryClient();
  const { customer, merchantId, user } = useAuthStore(
    useShallow((state) => ({
      customer: state.customer,
      merchantId: state.merchantId,
      user: state.user,
    }))
  );
  const activeMerchantId = merchantId || CONFIG.MERCHANT_ID;
  const activeMerchantSlug = CONFIG.MERCHANT_SLUG?.trim() || undefined;

  return useMutation({
    mutationFn: async () =>
      createWalletFundingAccount({
        merchantId: activeMerchantId,
        merchantSlug: activeMerchantSlug,
      }),
    onSuccess: async () => {
      const walletOwnerId = resolveWalletReadOwnerId(customer?.id, user?.id);
      if (!walletOwnerId || !activeMerchantId) {
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: walletKeys.data({
          merchantId: activeMerchantId,
          ownerId: walletOwnerId,
          userId: user?.id ?? undefined,
        }),
        exact: false,
      });
    },
  });
}
