import { useEffect, useState } from 'react';
import { applyWalletRouteAction } from '@/components/wallet/apply-wallet-route-action';
import { createLogger } from '@/lib/logger';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { storeWalletFundingIntent } from '@/lib/wallet-funding-intent';
import { startWalletFundingSession } from '@/lib/wallet-funding-session';

const log = createLogger('WalletRouteActionSetup');

interface UseWalletRouteActionSetupParams {
  bankTransfer: {
    canCreateFundingAccount: boolean;
    createFundingAccount: () => void;
    hasFundingAccount: boolean;
    hasWalletData: boolean;
    isCreating: boolean;
    needsPhone: boolean;
  };
  customerId: string | undefined;
  routeAction: string | undefined;
  routeSavingsGoalId?: string;
  /**
   * Per-navigation nonce from `/wallet?action=bank-transfer&intent=…`. Identifies
   * WHICH bank-transfer attempt this is, so a remount of the same attempt keeps
   * its funding-session anchor while a genuinely new attempt restamps it.
   */
  routeIntentId: string | undefined;
  routeRequiredAmount: string;
  setFundAmount: (value: string) => void;
  setFundReturnTo: (value: WalletReturnHref | undefined) => void;
  setShowFundPanel: (value: boolean) => void;
  setShowRedeemPanel: (value: boolean) => void;
  setShowSavingsProgressModal: (value: boolean) => void;
  walletReturnTo: WalletReturnHref | undefined;
}

/**
 * Owns wallet route-action synchronisation: re-applies panel state when the
 * route action changes (render-phase, no stale-frame effect), and handles
 * `action=bank-transfer` — choosing "Pay with Bank Transfer" IS the
 * customer's consent, so their wallet funding account (DVA) is created
 * automatically once the wallet loads, unless one already exists (the hero
 * pill then already shows their account number).
 */
export function useWalletRouteActionSetup({
  bankTransfer,
  customerId,
  routeAction,
  routeSavingsGoalId,
  routeIntentId,
  routeRequiredAmount,
  setFundAmount,
  setFundReturnTo,
  setShowFundPanel,
  setShowRedeemPanel,
  setShowSavingsProgressModal,
  walletReturnTo,
}: UseWalletRouteActionSetupParams) {
  const isBankTransferAction = routeAction === 'bank-transfer';
  const fundingSessionKey =
    isBankTransferAction && customerId
      ? `${customerId}|${routeIntentId ?? ''}`
      : null;
  const [resolvedFundingSessionKey, setResolvedFundingSessionKey] = useState<
    string | null
  >(fundingSessionKey === null ? null : '');
  const [pendingBankTransfer, setPendingBankTransfer] =
    useState(isBankTransferAction);
  // customerId is deliberately NOT in this key: async auth hydration flips it
  // undefined→id right after mount, and re-running applyWalletRouteAction then
  // would re-seed a fund URL's amount / reset panels mid-input.
  const savingsRouteKey =
    routeAction === 'savings' ? (routeSavingsGoalId ?? '') : '';
  const routeActionKey = `${routeAction ?? ''}|${routeRequiredAmount}|${walletReturnTo ?? ''}|${savingsRouteKey}`;
  const [prevRouteActionKey, setPrevRouteActionKey] = useState(routeActionKey);
  if (prevRouteActionKey !== routeActionKey) {
    setPrevRouteActionKey(routeActionKey);
    setPendingBankTransfer(isBankTransferAction);
    applyWalletRouteAction({
      routeAction,
      routeRequiredAmount,
      walletReturnTo,
      setFundAmount,
      setFundReturnTo,
      setShowFundPanel,
      setShowRedeemPanel,
      setShowSavingsProgressModal,
    });
  }

  // Re-arm the bank-transfer latch ONLY when the customer changes on a
  // bank-transfer route, so a customer switch provisions the new customer's
  // DVA — without re-running applyWalletRouteAction (which would disturb a
  // fund/redeem/savings surface). Scoped so async customer hydration on a
  // NON-bank-transfer route is a no-op.
  const [prevCustomerId, setPrevCustomerId] = useState(customerId);
  if (customerId !== prevCustomerId) {
    setPrevCustomerId(customerId);
    if (isBankTransferAction) {
      setPendingBankTransfer(true);
    }
  }

  // Landing on `/wallet?action=bank-transfer` IS the moment the customer
  // expressed bank-transfer funding intent — the earliest point at which we know
  // it, and strictly before any account number can be shown (the DVA is created
  // below), so no transfer can have happened yet. Persist it: the credit watch
  // baselines its ledger snapshot on this timestamp, which must survive the
  // customer leaving for their bank app and the screen remounting (or the app
  // being killed) with the credit already in the ledger.
  //
  // `routeIntentId` is what makes re-running safe AND correct: a remount replays
  // the same nonce (anchor preserved — the credit that landed while they were
  // away is still detectable), while a genuinely new attempt arrives with a new
  // nonce (anchor restamped — a credit from the previous, unacknowledged attempt
  // cannot be re-announced as this one's).
  useEffect(() => {
    if (!fundingSessionKey || !customerId) {
      return;
    }
    let isActive = true;
    void startWalletFundingSession(customerId, routeIntentId)
      .then(() => {
        if (isActive) {
          setResolvedFundingSessionKey(fundingSessionKey);
        }
      })
      .catch((error: unknown) => {
        // The storage helper normally converts failures to `null`. An actual
        // rejection is unexpected, so keep the readiness gate closed: reading
        // the ledger without the intended session could baseline away a credit.
        log.warn(
          'Wallet funding session write rejected; baseline stays gated.',
          {
            error,
          }
        );
      });
    return () => {
      isActive = false;
    };
  }, [customerId, fundingSessionKey, routeIntentId]);

  // Record the onward destination the moment the customer reaches the funding
  // surface with one. The CARD path also persists it server-side (via
  // `/wallet/top-up/initialize`), but a BANK-TRANSFER top-up has no client
  // initialize call at all — the DVA is a standing account number and the
  // transaction is created by the webhook — so this local, single-use,
  // TTL-bounded intent is the only place the destination can survive an async
  // transfer. Read back (and cleared) by the wallet-credited push tap when the
  // payload has no `returnTo`. Non-resumable values are rejected on write.
  //
  // Scoped to the signed-in customer, and deliberately NOT written while the
  // customer is still hydrating (an unattributable intent would be cleared by
  // the lib, which could race the real write): a shared device or an account
  // switch inside the TTL must never let a new customer's DVA credit resume the
  // previous customer's interrupted purchase.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new route nonce intentionally restamps the same destination.
  useEffect(() => {
    if (
      !customerId ||
      (routeAction !== 'fund' && routeAction !== 'bank-transfer')
    ) {
      return;
    }
    // An explicit funding surface without a destination disarms an abandoned
    // old flow. Unrelated wallet opens must preserve an in-flight DVA intent.
    void storeWalletFundingIntent({
      customerId,
      returnTo: walletReturnTo,
    }).catch((error: unknown) => {
      log.warn('Wallet funding intent write rejected.', { error });
    });
  }, [customerId, routeAction, routeIntentId, walletReturnTo]);

  const {
    canCreateFundingAccount,
    createFundingAccount,
    hasFundingAccount,
    hasWalletData,
    isCreating,
    needsPhone,
  } = bankTransfer;
  useEffect(() => {
    if (!pendingBankTransfer || !hasWalletData) {
      return;
    }
    if (hasFundingAccount) {
      setPendingBankTransfer(false);
      return;
    }
    if (needsPhone) {
      // Can't auto-create without a phone — open the fund panel so its prompt
      // collects it, then let the panel's auto-create complete the intent.
      setShowFundPanel(true);
      setPendingBankTransfer(false);
      return;
    }
    if (!canCreateFundingAccount || isCreating) {
      return;
    }
    setPendingBankTransfer(false);
    createFundingAccount();
  }, [
    canCreateFundingAccount,
    createFundingAccount,
    hasFundingAccount,
    hasWalletData,
    isCreating,
    needsPhone,
    pendingBankTransfer,
    setShowFundPanel,
  ]);

  // The child credit-watch effect must not read/anchor the ledger until this
  // route's session write has settled. Child passive effects can run before a
  // parent's passive effect on mount; without this gate the watch can observe
  // "no session", baseline the current ledger, and then have the parent write
  // an unanchored marker. A remount after the transfer would anchor that marker
  // on the newly landed credit and swallow it.
  return (
    fundingSessionKey === null ||
    resolvedFundingSessionKey === fundingSessionKey
  );
}
