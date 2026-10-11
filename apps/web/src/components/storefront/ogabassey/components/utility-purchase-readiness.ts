import type { CustomerUser } from '@/contexts/customer-auth-context';
import { toast } from '@/hooks/use-toast';

interface CheckUtilityPurchaseReadinessInput {
  amount: number;
  canFundByBankTransfer: boolean;
  isAuthLoading: boolean;
  isAuthenticated: boolean;
  onInsufficientWalletBalance?: () => void;
  refreshWallet: () => void;
  user: CustomerUser | null;
  walletBalance: number;
  walletError: boolean;
  walletLoading: boolean;
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
  onInsufficientWalletBalance,
  refreshWallet,
  user,
  walletBalance,
  walletError,
  walletLoading,
}: CheckUtilityPurchaseReadinessInput): boolean {
  if (isAuthLoading) {
    toast({
      title: 'Checking account',
      description: 'Please wait while we confirm your session.',
    });
    return false;
  }

  if (!isAuthenticated || !user) {
    toast({
      title: 'Sign in required',
      description: 'Please sign in to use utility checkout.',
      variant: 'destructive',
    });
    return false;
  }

  // A failed or still-loading wallet fetch also reads as balance 0 — never
  // report that as insufficient funds. Loading asks for patience; an error
  // retries the fetch so the customer is not stuck until remount.
  if (walletLoading) {
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
  // the remaining shortfall so partial balances don't overfund.
  if (walletBalance < amount) {
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
