import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useRef } from 'react';
import { CONFIG } from '@/lib/config';
import {
  forgetPendingVtuPurchase,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
  scopePendingVtuKey,
} from '@/lib/pending-vtu-idempotency';
import { resolveIdempotencyScopeOwnerId } from '@/lib/utility-owner-ids';
import { useAuthStore } from '@/stores/auth-store';
import { useWallet } from './use-wallet';
import { useMerchantPaymentSettings } from './useMerchantPaymentSettings';
import { walletKeys } from './wallet-query';

/**
 * Wallet-only utility payment state. Utilities are always charged to wallet
 * balance — there is no gateway or saved-card fallback. The hook exposes the
 * wallet balance/loading/error, bank-transfer funding eligibility (for the
 * funding nudge), and the wallet-only idempotency key lifecycle.
 */
export function useUtilityPayment() {
  const isAuthenticated = useAuthStore((state) => !!state.session);
  // Owner + merchant captured ONCE per submission (NOT a module-global
  // scope): a key remembered for one customer must never be recalled
  // for another after sign-out / account switch — the route would
  // reject it as belonging to the first customer — and a global would
  // let a mid-flight switch redirect one customer's completion onto
  // another customer's entry. Owner is the stable Supabase user ID
  // first (NOT customer-first like the wallet reads): customers.id
  // lands later via hydration, and flipping scope mid-session would
  // orphan the pending key and double-debit the retry. Merchant uses
  // the same CONFIG fallback as the wallet reads for the same reason.
  const ownerId = useAuthStore((state) =>
    resolveIdempotencyScopeOwnerId(state.user?.id, state.customer?.id)
  );
  // Raw auth user id for token binding: the scope owner above falls
  // back to the customer row, but the checkout token belongs to the
  // auth user, so the binding capture must not use the fallback.
  const submittingUserId = useAuthStore((state) => state.user?.id);
  const merchantId = useAuthStore((state) => state.merchantId);
  // Latest signed-in owner, refreshed every render. Compared against
  // the submitter when a checkout settles so an account switch (or
  // sign-out) mid-flight discards the stale result instead of writing
  // one customer's success screen into another's session.
  const latestOwnerRef = useRef<string | undefined>(undefined);
  latestOwnerRef.current = ownerId;
  const scopePendingVtuDescriptor = (descriptor: string): string =>
    scopePendingVtuKey(ownerId, merchantId || CONFIG.MERCHANT_ID, descriptor);
  // Wallet-only Idempotency-Key. Recalled from the cross-mount pending
  // registry by purchase descriptor — a ref alone loses the key when
  // the form remounts (Back to Home, reopen Utilities), and the retry
  // would mint a fresh UUID the server debits as a SECOND transaction.
  // Rotated only after a definitive HTTP response (success or 4xx).
  const paymentSettings = useMerchantPaymentSettings();
  const wallet = useWallet();
  const queryClient = useQueryClient();
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
    /**
     * Captures the submitting owner at submit time. Handlers MUST call
     * this before the wallet request and check the capture with
     * `isSubmittingOwnerCurrent` once it settles.
     */
    captureSubmittingOwner: () => ownerId,
    /**
     * Captures the auth user id at submit time. Handlers MUST pass it
     * as `expectedUserId` so a token acquired after a mid-flight
     * account switch aborts instead of debiting the wrong wallet.
     */
    captureSubmittingUserId: () => submittingUserId,
    isAuthenticated,
    /**
     * True while the capture from `captureSubmittingOwner` still
     * matches the signed-in owner. False after an account switch or
     * sign-out mid-flight — the caller must discard the result.
     */
    isSubmittingOwnerCurrent: (submittingOwner: string | undefined) =>
      latestOwnerRef.current === submittingOwner,
    /**
     * Marks every cached wallet query stale (all owners + merchants —
     * the query keys are owner-scoped and the submitter's identity is
     * no longer signed in). Called when an account switch discards a
     * settled result: without this, switching back within the stale
     * window would serve the cached pre-debit balance.
     */
    invalidateWallets: () => {
      void queryClient.invalidateQueries({ queryKey: walletKeys.all });
    },
    refetchWallet: () => {
      void wallet.refetch();
    },
    /**
     * Binds a purchase descriptor to the submitting owner + merchant.
     * Handlers MUST scope once per submission and pass the scoped key
     * to every registry call, so a mid-flight account switch cannot
     * redirect this submission's completion onto another entry.
     */
    scopePendingVtuDescriptor,
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
