import * as Crypto from 'expo-crypto';
import { useRef } from 'react';
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
  // Wallet-only Idempotency-Key. Held in a ref so a network failure
  // doesn't lose the key — the user's retry MUST send the same key
  // for the route's `vtu_idempotency_keys` table to dedupe.
  // Rotated only after a definitive HTTP response (success or 4xx).
  const walletIdempotencyKeyRef = useRef<string | null>(null);
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
    walletBalance,
    walletError,
    walletIsLoading: wallet.isLoading,
    /**
     * Returns the active wallet-only Idempotency-Key (UUID), creating
     * one on first call. Subsequent calls within the same submit
     * cycle MUST receive the same key — that's the entire dedupe
     * contract with the wallet-only route.
     */
    getWalletIdempotencyKey: () => {
      if (!walletIdempotencyKeyRef.current) {
        walletIdempotencyKeyRef.current = Crypto.randomUUID();
      }
      return walletIdempotencyKeyRef.current;
    },
    /**
     * Clears the cached key after a definitive response (success or
     * 4xx). The next submit will mint a fresh UUID. Network failures
     * (TimeoutError / NetworkError) MUST NOT call this — the key
     * must survive so the user's retry hits the dedupe table.
     */
    resetWalletIdempotencyKey: () => {
      walletIdempotencyKeyRef.current = null;
    },
  };
}
