import * as Crypto from 'expo-crypto';
import {
  forgetPendingVtuPurchase,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
  setPendingVtuOwnerScope,
} from '@/lib/pending-vtu-idempotency';
import { useAuthStore } from '@/stores/auth-store';
import { useWallet } from './use-wallet';
import { useMerchantPaymentSettings } from './useMerchantPaymentSettings';

/**
 * Wallet-only utility payment state. Utilities are always charged to wallet
 * balance — there is no gateway or saved-card fallback. The hook exposes the
 * wallet balance/loading/error, bank-transfer funding eligibility (for the
 * funding nudge), and the wallet-only idempotency key lifecycle.
 */
export function useUtilityPayment() {
  const isAuthenticated = useAuthStore((state) => !!state.session);
  // Scope pending-key recall to the current owner + merchant (same owner
  // fallback the wallet reads with): a key remembered for one customer
  // must never be recalled for another after sign-out / account switch —
  // the route would reject it as belonging to the first customer.
  const ownerId = useAuthStore((state) => state.customer?.id ?? state.user?.id);
  const merchantId = useAuthStore((state) => state.merchantId);
  setPendingVtuOwnerScope(ownerId, merchantId);
  // Wallet-only Idempotency-Key. Recalled from the cross-mount pending
  // registry by purchase descriptor — a ref alone loses the key when
  // the form remounts (Back to Home, reopen Utilities), and the retry
  // would mint a fresh UUID the server debits as a SECOND transaction.
  // Rotated only after a definitive HTTP response (success or 4xx).
  const paymentSettings = useMerchantPaymentSettings();
  const wallet = useWallet();
  // The bank-transfer funding nudge deep-links into DVA territory, so offer
  // it to any signed-in customer of a merchant with wallet DVAs enabled. No
  // phone/funding_account precondition: the wallet funding flow now collects
  // the customer's phone at the point of need and creates the DVA on the
  // spot, so a phoneless customer is no longer a dead end.
  const canFundByBankTransfer =
    isAuthenticated &&
    paymentSettings.data?.wallet_paystack_dva_enabled === true;
  const walletBalance = wallet.data?.wallet.balance ?? 0;
  const walletError = wallet.error instanceof Error ? wallet.error : null;

  return {
    canFundByBankTransfer,
    isAuthenticated,
    refetchWallet: () => {
      void wallet.refetch();
    },
    walletBalance,
    walletError,
    walletIsLoading: wallet.isLoading,
    /**
     * Returns the wallet-only Idempotency-Key (UUID) for this purchase
     * descriptor, recalling a still-pending key across form remounts
     * and minting + remembering a fresh one otherwise. The same
     * descriptor MUST receive the same key until reset — that's the
     * entire dedupe contract with the wallet-only route.
     */
    getWalletIdempotencyKey: (descriptor: string) => {
      const recalled = recallPendingVtuKey(descriptor);
      if (recalled) return recalled;
      const minted = Crypto.randomUUID();
      rememberPendingVtuPurchase(descriptor, minted);
      return minted;
    },
    /**
     * Forgets the descriptor's key after a definitive response (success
     * or 4xx). The next submit for it mints a fresh UUID. Network
     * failures (TimeoutError / NetworkError) MUST NOT call this — the
     * key must survive so the user's retry hits the dedupe table.
     */
    resetWalletIdempotencyKey: (descriptor: string) => {
      forgetPendingVtuPurchase(descriptor);
    },
  };
}
