import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CONFIG } from '@/lib/config';
import {
  createLiveWalletQuery,
  walletIdentitiesAgree,
} from '@/lib/live-wallet-query';
import { resolveWalletReadOwnerId } from '@/lib/utility-owner-ids';
import { createWalletFundingAccount } from '@/lib/wallet-funding-account';
import { useAuthStore } from '@/stores/auth-store';
import { piggyvestWalletSetupQuery } from './piggyvest-wallet-setup-query';
import { readPrimaryFundingAccount } from './resolve-wallet-funding-account';
import { useWalletRealtime } from './use-wallet-realtime';
import { fetchWalletDataUnbounded } from './wallet-data';
import { runWithWalletLoadDeadline } from './wallet-load-deadline';
import { type WalletData, walletKeys } from './wallet-query';

export { useRedeemPoints } from './use-redeem-points';
export type { WalletQueryData } from './wallet-query';
export { walletKeys } from './wallet-query';

const WALLET_STRICT_STALE_TIME_MS = 30_000;
const WALLET_STRICT_GC_TIME_MS = 5 * 60_000;
const WALLET_DISPLAY_STALE_TIME_MS = 2 * 60_000;
const WALLET_DISPLAY_GC_TIME_MS = 30 * 60_000;

interface UseWalletOptions {
  cachePolicy?: 'strict' | 'display';
  navigationRefresh?: 'full' | 'numbers';
  progressive?: boolean;
}

export function useWallet(options: UseWalletOptions = {}) {
  const queryClient = useQueryClient();
  const { customer, merchantId, user } = useAuthStore(
    useShallow((state) => ({
      customer: state.customer,
      merchantId: state.merchantId,
      user: state.user,
    }))
  );
  const [preview, setPreview] = useState<{
    scope: string;
    wallet: WalletData;
  } | null>(null);
  const walletOwnerId = resolveWalletReadOwnerId(customer?.id, user?.id);
  const activeMerchantId = merchantId || CONFIG.MERCHANT_ID;
  const identityAgreed = walletIdentitiesAgree(customer, user?.id);
  const enabled = !!walletOwnerId && !!activeMerchantId && identityAgreed;
  const walletQueryKey = enabled
    ? walletKeys.data({
        merchantId: activeMerchantId,
        ownerId: walletOwnerId,
        userId: user?.id ?? undefined,
      })
    : (['wallet', 'disabled'] as const);
  const scopeId = JSON.stringify(walletQueryKey);
  const numbersOnly = options.navigationRefresh === 'numbers';
  const display = options.cachePolicy === 'display';
  const {
    data,
    dataUpdatedAt,
    error,
    fetchStatus,
    isError,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: walletQueryKey,
    queryFn: ({ signal }) => {
      if (!options.progressive) {
        return runWithWalletLoadDeadline(
          () =>
            fetchWalletDataUnbounded(
              customer?.id ?? null,
              activeMerchantId,
              user?.id ?? null
            ),
          signal
        );
      }
      setPreview(null);
      return runWithWalletLoadDeadline(
        () =>
          fetchWalletDataUnbounded(
            customer?.id ?? null,
            activeMerchantId,
            user?.id ?? null,
            {
              onBalances: (wallet) => {
                if (!signal.aborted) setPreview({ scope: scopeId, wallet });
              },
              readPrimary: (merchant, owner) =>
                readPrimaryFundingAccount(merchant, owner, () =>
                  queryClient.fetchQuery({
                    ...piggyvestWalletSetupQuery(queryClient, merchant, owner),
                    staleTime: 0,
                  })
                ),
            }
          ),
        signal
      );
    },
    enabled,
    staleTime: display
      ? WALLET_DISPLAY_STALE_TIME_MS
      : WALLET_STRICT_STALE_TIME_MS,
    gcTime: display ? WALLET_DISPLAY_GC_TIME_MS : WALLET_STRICT_GC_TIME_MS,
    refetchOnMount: numbersOnly ? false : display ? 'always' : true,
    refetchOnWindowFocus: !numbersOnly,
    refetchOnReconnect: !numbersOnly,
  });
  const realtime = useWalletRealtime({
    customerId: customer?.id,
    merchantId: activeMerchantId,
    userId: user?.id,
    key: walletQueryKey,
    numbersOnly,
    enabled,
    walletId: data?.walletId,
    updatedAt: dataUpdatedAt,
  });
  const liveWalletQuery = createLiveWalletQuery(queryClient);

  return {
    data: identityAgreed ? data : undefined,
    balancePreview:
      identityAgreed && preview?.scope === scopeId ? preview.wallet : undefined,
    error: error ?? realtime.error,
    fetchStatus: realtime.isPaused ? ('paused' as const) : fetchStatus,
    getWalletBalance: liveWalletQuery.getBalance,
    getWalletError: liveWalletQuery.getError,
    isError: isError || realtime.isError,
    isFetchingNow: liveWalletQuery.isFetching,
    isLoading,
    isRefetching: isRefetching || realtime.isPending,
    isWalletSettled: liveWalletQuery.isSettled,
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
      if (!walletOwnerId || !activeMerchantId) return;
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
