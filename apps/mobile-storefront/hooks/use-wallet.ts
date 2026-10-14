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
 * Both identities present but disagreeing (customer row linked to a
 * different auth user) means a switch is mid-flight: the query
 * stays held until they agree.
 */
function walletIdentitiesAgree(
  customer: { id?: string | null; user_id?: string | null } | null | undefined,
  userId: string | null | undefined
): boolean {
  return !customer?.id || !userId || (customer.user_id ?? userId) === userId;
}

/**
 * Live wallet-query locator (Muse R2): resolves the query key from
 * the CURRENT auth-store identity, not the render that created the
 * hook. The gate readers below run AFTER the settlement-gate await,
 * when an account switch may have moved the identity (and key) on
 * from the render-time one — reading the stale key would return the
 * previous owner's cached balance. Null key = query cannot run.
 */
function resolveLiveWalletQuery(): {
  key: ReturnType<typeof walletKeys.data> | null;
  identityAgreed: boolean;
} {
  const { customer, merchantId, user } = useAuthStore.getState();
  const identityAgreed = walletIdentitiesAgree(customer, user?.id);
  const ownerId = resolveWalletReadOwnerId(customer?.id, user?.id);
  const liveMerchantId = merchantId || CONFIG.MERCHANT_ID;
  if (!ownerId || !liveMerchantId) {
    return { key: null, identityAgreed };
  }
  return {
    key: walletKeys.data({
      merchantId: liveMerchantId,
      ownerId,
      userId: user?.id ?? undefined,
    }),
    identityAgreed,
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
  // Hold the query — including the primary probe — until the
  // identities agree, so the load can never mix one identity's
  // wallet with another's funding account.
  const identityAgreed = walletIdentitiesAgree(customer, user?.id);
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
    // Live reader (Codex R78 6sN80p, Muse R2): purchase closures
    // capture the render-time balance before the settlement-gate
    // await; a refetch completing mid-await leaves that snapshot
    // stale while fresh data sits in the cache. Read the cache
    // imperatively — under the LIVE key, since a mid-await account
    // switch moves the identity (and key) on from this render's.
    getWalletBalance: () => {
      const { key } = resolveLiveWalletQuery();
      return (
        (key
          ? queryClient.getQueryData<typeof data>(key)?.wallet.balance
          : undefined) ?? 0
      );
    },
    isError,
    // Live reader (Codex R75 6r486a, Muse R2): readiness gates call
    // this AFTER the settlement-gate await, when the render-time
    // isRefetching snapshot is stale. Reads the cache imperatively
    // under the LIVE key, so a refetch starting mid-await — even
    // under a switched identity — still blocks. exact: owner-scoped.
    isFetchingNow: () => {
      const { key } = resolveLiveWalletQuery();
      return key
        ? queryClient.isFetching({ queryKey: key, exact: true }) > 0
        : false;
    },
    // Live reader (Muse R2): true only when the CURRENT identity's
    // query is enabled (owner resolved, identities agreed) and the
    // cache holds its data. A disabled query is not loading, not
    // refetching, and error-free — without this the gate would read
    // its missing data as a zero balance and open funding.
    isWalletSettled: () => {
      const { key, identityAgreed: liveAgreed } = resolveLiveWalletQuery();
      if (!liveAgreed || !key) {
        return false;
      }
      return (queryClient.getQueryState(key)?.dataUpdatedAt ?? 0) > 0;
    },
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
