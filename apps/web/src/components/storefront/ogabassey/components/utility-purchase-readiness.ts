import type { CustomerUser } from '@/contexts/customer-auth-context';
import { toast } from '@/hooks/use-toast';

interface CheckUtilityPurchaseReadinessInput {
  amount: number;
  canFundByBankTransfer: boolean;
  isAuthLoading: boolean;
  isAuthenticated: boolean;
  /** True when this exact purchase already has a retained attempt. */
  isRetainedReplay?: boolean;
  merchantId: string | undefined;
  onInsufficientWalletBalance?: () => void;
  refreshWallet: () => void;
  user: CustomerUser | null;
  walletBalance: number;
  walletError: boolean;
  walletLoading: boolean;
  walletRefreshPending: boolean;
}

/**
 * Pre-submit readiness gates for wallet-only utility checkout, extracted
 * from `useUtilityPurchase` to keep that hook under the 300-line
 * modularity budget. Returns true when the purchase may proceed to the
 * network call; every blocked path toasts the reason (and retries or
 * opens funding where applicable) so callers just early-return.
 */
export function checkUtilityPurchaseReadiness({
  amount,
  canFundByBankTransfer,
  isAuthLoading,
  isAuthenticated,
  isRetainedReplay = false,
  merchantId,
  onInsufficientWalletBalance,
  refreshWallet,
  user,
  walletBalance,
  walletError,
  walletLoading,
  walletRefreshPending,
}: CheckUtilityPurchaseReadinessInput): boolean {
  if (isAuthLoading) {
    toast({
      title: 'Checking account',
      description: 'Please wait while we confirm your session.',
    });
    return false;
  }

  // Invariant (customer-auth-context: isAuthenticated = !!user &&
  // !!customer): an authenticated session always carries a user row,
  // so the `!user` disjunct is unreachable defense-in-depth, not a
  // customer-only-session rejection — the route would 401 those anyway.
  if (!isAuthenticated || !user) {
    toast({
      title: 'Sign in required',
      description: 'Please sign in to use utility checkout.',
      variant: 'destructive',
    });
    return false;
  }

  // The idempotency scope is keyed by merchant ID: submitting before it
  // hydrates would scope the key under '' and a post-hydration retry
  // would miss recall, mint fresh, and debit twice. (The wallet gates
  // below would usually block first, but this makes the invariant
  // explicit instead of incidental.)
  if (!merchantId) {
    toast({
      title: 'Store unavailable',
      description: 'Please wait while the store finishes loading.',
    });
    return false;
  }

  // A failed or still-loading wallet fetch also reads as balance 0 — never
  // report that as insufficient funds. Loading asks for patience; an error
  // retries the fetch so the customer is not stuck until remount.
  // `walletRefreshPending` covers the commit/effect race: refreshWallet()
  // sets it synchronously, before the fetch effect flips walletLoading,
  // so a click in that interval still blocks on the stale balance.
  if (walletLoading || walletRefreshPending) {
    toast({
      title: 'Checking wallet balance',
      description: 'Please wait while we confirm your wallet balance.',
    });
    return false;
  }

  if (walletError) {
    toast({
      title: 'Wallet unavailable',
      description: "We couldn't load your wallet balance. Trying again now.",
      variant: 'destructive',
    });
    refreshWallet();
    return false;
  }

  // Wallet-only checkout: the wallet must cover the full bill — there is
  // no card fallback. Stop here (before any network call) and let the
  // caller open the funding panel so the customer can top up. Report only
  // the remaining shortfall so partial balances don't overfund. A RETAINED
  // replay skips this gate only: the wallet was already debited for this
  // exact purchase, so a post-debit dip must not strand recovery behind
  // top-up. Auth/loading/error gates above still apply.
  if (!isRetainedReplay && walletBalance < amount) {
    const shortfall = amount - walletBalance;
    if (!canFundByBankTransfer) {
      // No funding rail on web for this store (DVAs disabled, no card
      // top-up UI): say so plainly instead of promising a panel that
      // cannot provision an account.
      toast({
        title: 'Insufficient wallet balance',
        description: `Your wallet balance of ₦${walletBalance.toLocaleString()} is ₦${shortfall.toLocaleString()} short. Wallet top-up isn't available for this store.`,
        variant: 'destructive',
      });
      return false;
    }
    toast({
      title: 'Insufficient wallet balance',
      description: `Fund your wallet with at least ₦${shortfall.toLocaleString()} more to complete this purchase.`,
      variant: 'destructive',
    });
    onInsufficientWalletBalance?.();
    return false;
  }

  return true;
}
