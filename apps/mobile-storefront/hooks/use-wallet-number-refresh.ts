import { useMutation, useQueryClient } from '@tanstack/react-query';
import { mergeSavingsHistory } from './merge-savings-history';
import { mergeWalletNumbers } from './merge-wallet-numbers';
import { fetchWalletNumbers } from './wallet-number-data';
import { type WalletQueryData, walletKeys } from './wallet-query';
import { fetchWalletTransactions } from './wallet-transaction-data';

interface WalletNumberRefreshRequest {
  customerId: string | null;
  merchantId: string;
  userId: string;
  isCurrent: () => boolean;
  refetchFull: () => Promise<unknown>;
  includeTransactions?: boolean;
}

export function useWalletNumberRefresh() {
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (request: WalletNumberRefreshRequest) => {
      const { customerId, merchantId, userId, isCurrent, refetchFull } =
        request;
      const key = walletKeys.data({
        merchantId,
        ownerId: customerId ?? userId,
        userId,
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!isCurrent()) return;
        if (client.getQueryState(key)?.fetchStatus === 'fetching')
          await refetchFull();
        if (!isCurrent()) return;
        const cached = client.getQueryData<WalletQueryData>(key);
        const updatedAt = client.getQueryState(key)?.dataUpdatedAt;
        if (
          !cached?.wallet.funding_account ||
          (request.includeTransactions && !cached.walletId) ||
          client.getQueryState(key)?.isInvalidated
        ) {
          await refetchFull();
          return;
        }
        let fresh: Awaited<ReturnType<typeof fetchWalletNumbers>>;
        let transactions:
          | Awaited<ReturnType<typeof fetchWalletTransactions>>
          | undefined;
        try {
          fresh = await fetchWalletNumbers(customerId, merchantId, userId);
          transactions = request.includeTransactions
            ? await fetchWalletTransactions(merchantId, cached.walletId)
            : undefined;
        } catch {
          if (isCurrent()) await refetchFull();
          return;
        }
        if (!isCurrent()) return;
        if (
          client.getQueryState(key)?.fetchStatus === 'fetching' ||
          client.getQueryData(key) !== cached
        )
          continue;
        const merged = mergeWalletNumbers(cached, fresh);
        if (!merged) {
          await refetchFull();
          return;
        }
        client.setQueryData(
          key,
          transactions
            ? {
                ...merged,
                transactions: mergeSavingsHistory(
                  transactions,
                  fresh?.interestTransactions
                ),
              }
            : merged,
          { updatedAt }
        );
        return;
      }
      throw new Error('Wallet changed while refreshing. Please try again.');
    },
  });
}
