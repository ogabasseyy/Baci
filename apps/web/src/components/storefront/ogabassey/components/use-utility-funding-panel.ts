'use client';

import { useState } from 'react';
import type { StorefrontWalletFundingAccount } from '@baci/shared';

interface UseUtilityFundingPanelInput {
  fundingAccount: StorefrontWalletFundingAccount | null;
  isAuthenticated: boolean;
  merchantSlug?: string;
  requiresFundingAccountConsent: boolean;
  userId?: string;
  walletDvaEnabled: boolean;
}

interface UseUtilityFundingPanelResult {
  canFundByBankTransfer: boolean;
  closeFundingPanel: () => void;
  fundingPanelAutoCreate: boolean;
  openForInsufficientBalance: () => void;
  showFundingPanel: boolean;
  toggleFromExplicitChoice: () => void;
}

/**
 * Owns the UtilityModal bank-transfer funding panel: visibility, DVA
 * auto-create consent, and the funding eligibility gate.
 *
 * Consent rule: the panel's `autoCreate` treats mounting with `true` as
 * consent to provision a DVA, so only the explicit "Pay with Bank Transfer"
 * tap sets it — programmatic opens (insufficient balance) keep the panel's
 * own CTA as the consent point.
 */
export const useUtilityFundingPanel = ({
  fundingAccount,
  isAuthenticated,
  merchantSlug,
  requiresFundingAccountConsent,
  userId,
  walletDvaEnabled,
}: UseUtilityFundingPanelInput): UseUtilityFundingPanelResult => {
  const [showFundingPanel, setShowFundingPanel] = useState(false);
  const [fundingPanelAutoCreate, setFundingPanelAutoCreate] = useState(true);
  // The DVA is the customer's wallet funding account. Offer the action when
  // the merchant supports DVAs and the wallet API says either an account
  // exists or account creation is available; the panel collects a missing
  // phone at the point of need instead of hiding the action.
  const canFundByBankTransfer =
    isAuthenticated &&
    walletDvaEnabled &&
    (Boolean(fundingAccount) || requiresFundingAccountConsent);

  // Collapse the funding panel if the signed-in customer OR the storefront
  // merchant changes while the modal stays mounted — a previous session's
  // open bank-transfer panel (with its DVA account number) must not carry
  // over to a different customer or merchant.
  const fundingIdentity = `${userId ?? ''}:${merchantSlug ?? ''}`;
  const [prevFundingIdentity, setPrevFundingIdentity] =
    useState(fundingIdentity);
  if (fundingIdentity !== prevFundingIdentity) {
    setPrevFundingIdentity(fundingIdentity);
    setShowFundingPanel(false);
  }

  // Plain handlers — React Compiler owns memoization (no useCallback).
  const closeFundingPanel = () => {
    setShowFundingPanel(false);
  };

  const openForInsufficientBalance = () => {
    // Wallet-only checkout: surface the funding panel WITHOUT auto-create
    // so the customer can top up and retry. No-op when bank-transfer
    // funding is unavailable.
    if (canFundByBankTransfer) {
      setFundingPanelAutoCreate(false);
      setShowFundingPanel(true);
    }
  };

  const toggleFromExplicitChoice = () => {
    // Explicit bank-transfer action: this IS the consent.
    setFundingPanelAutoCreate(true);
    setShowFundingPanel((visible) => !visible);
  };

  return {
    canFundByBankTransfer,
    closeFundingPanel,
    fundingPanelAutoCreate,
    openForInsufficientBalance,
    showFundingPanel,
    toggleFromExplicitChoice,
  };
};
