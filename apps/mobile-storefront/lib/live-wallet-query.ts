import type { QueryClient } from '@tanstack/react-query';
import { type WalletQueryData, walletKeys } from '@/hooks/wallet-query';
import { CONFIG } from '@/lib/config';
import { resolveWalletReadOwnerId } from '@/lib/utility-owner-ids';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Both identities present but disagreeing (customer row linked to a
 * different auth user) means a switch is mid-flight: the query
 * stays held until they agree. Shared with the wallet hook's
 * `enabled` flag so the gate and the query hold on one predicate.
 */
export function walletIdentitiesAgree(
  customer: { id?: string | null; user_id?: string | null } | null | undefined,
  userId: string | null | undefined
): boolean {
  return !customer?.id || !userId || (customer.user_id ?? userId) === userId;
}

/**
 * Live wallet-query locator: resolves the query key from the CURRENT
 * auth-store identity, not the render that created the hook. Gate
 * readers run AFTER the settlement-gate await, when an account
 * switch may have moved the identity (and key) on from the
 * render's — reading the stale key would return the previous
 * owner's cached balance. Null key = query cannot run.
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

export interface LiveWalletQuery {
  /**
   * Latest cached balance for the CURRENT identity (0 when the
   * query cannot run or has no data). Invoke at gate time: a
   * refetch completing mid-await refreshes the cache while the
   * purchase closure still holds the old number.
   */
  getBalance: () => number;
  /**
   * Latest request failure for the CURRENT identity, or null. A
   * refetch failing mid-await leaves stale data (settled, not
   * refetching) — only the cache knows the refresh failed. A later
   * success clears the failure. Non-Error rejections still report
   * presence: the gate must not submit on unconfirmed data.
   */
  getError: () => Error | null;
  /**
   * True while the CURRENT identity's query has a request in
   * flight. Invoke at gate time: a refetch starting mid-await is
   * about to replace the cached balance. exact: owner-scoped.
   */
  isFetching: () => boolean;
  /**
   * True only when the CURRENT identity's query is enabled (owner
   * resolved, identities agreed) and the cache holds its data. A
   * disabled query is not loading, not refetching, and error-free
   * — without this the gate would read missing data as zero.
   */
  isSettled: () => boolean;
}

/**
 * Live wallet-query readers bound to a query client. The hook
 * exposes these (not render-time snapshots) so readiness gates
 * evaluate the identity and cache as they stand AFTER the
 * settlement-gate await, not as the pre-await render saw them.
 */
export function createLiveWalletQuery(
  queryClient: QueryClient
): LiveWalletQuery {
  return {
    getBalance: () => {
      const { key } = resolveLiveWalletQuery();
      return (
        (key
          ? queryClient.getQueryData<WalletQueryData>(key)?.wallet.balance
          : undefined) ?? 0
      );
    },
    getError: () => {
      const { key } = resolveLiveWalletQuery();
      if (!key) {
        return null;
      }
      // Structural, not timestamped: a same-millisecond failure
      // and success share dataUpdatedAt/errorUpdatedAt, so clocks
      // cannot order them — but a success clears state.error while
      // a failure sets it, exactly the "latest request failed"
      // signal the gate needs.
      const error = queryClient.getQueryState(key)?.error;
      if (error == null) {
        return null;
      }
      return error instanceof Error
        ? error
        : new Error('Wallet refresh failed.');
    },
    isFetching: () => {
      const { key } = resolveLiveWalletQuery();
      return key
        ? queryClient.isFetching({ queryKey: key, exact: true }) > 0
        : false;
    },
    isSettled: () => {
      const { key, identityAgreed: liveAgreed } = resolveLiveWalletQuery();
      if (!liveAgreed || !key) {
        return false;
      }
      return (queryClient.getQueryState(key)?.dataUpdatedAt ?? 0) > 0;
    },
  };
}
