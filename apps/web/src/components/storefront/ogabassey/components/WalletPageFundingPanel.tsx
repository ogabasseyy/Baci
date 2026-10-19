'use client';

import type { StorefrontWallet } from '@baci/shared';
import type { Dispatch, SetStateAction } from 'react';
import { useOptionalCustomerAuth } from '@/contexts/customer-auth-context';
import { WALLET_FUNDING_TELEMETRY } from '@/lib/posthog/wallet-funding-events';
import { WalletFundingPanel } from './WalletFundingPanel';

interface WalletPageFundingPanelProps {
  customerId: string | undefined;
  customerPhone: string | null | undefined;
  merchantSlug: string | undefined;
  onUpdateCustomerPhone?: (
    phone: string
  ) => Promise<{ success: boolean; error?: string }>;
  onRefresh: () => void;
  setWallet: Dispatch<SetStateAction<StorefrontWallet | null>>;
  wallet: StorefrontWallet | null;
}

/**
 * Wallet-page wiring for the bank-transfer (Paystack DVA) funding panel.
 * Extracted from `pages/wallet.tsx` so that page stays under the 300-line
 * budget. Owns the derivations the panel needs: the account/baseline pulled
 * from the fetched wallet, the consent gate, and the local wallet-state patch
 * applied when an account is created.
 */
export function WalletPageFundingPanel({
  customerId,
  customerPhone,
  merchantSlug,
  onUpdateCustomerPhone,
  onRefresh,
  setWallet,
  wallet,
}: WalletPageFundingPanelProps) {
  const auth = useOptionalCustomerAuth();
  const onUpdateCustomerName = auth?.updateCustomer
    ? (firstName: string, lastName: string) =>
        auth.updateCustomer({ first_name: firstName, last_name: lastName })
    : undefined;

  return (
    <WalletFundingPanel
      account={wallet?.fundingAccount ?? null}
      customerId={customerId}
      customerFirstName={auth?.customer?.first_name ?? null}
      customerLastName={auth?.customer?.last_name ?? null}
      customerPhone={customerPhone}
      merchantSlug={merchantSlug}
      onAccountCreated={(account) =>
        setWallet((current) =>
          current
            ? {
                ...current,
                fundingAccount: account,
                requiresFundingAccountConsent: false,
              }
            : current
        )
      }
      onRefreshBalance={onRefresh}
      onUpdateCustomerName={onUpdateCustomerName}
      onUpdateCustomerPhone={onUpdateCustomerPhone}
      // Baseline for the funding check loop: the top-up credits the wallet
      // already had before the customer left to transfer.
      walletTransactions={wallet?.transactions ?? []}
      requiresConsent={
        wallet?.requiresFundingAccountConsent === true &&
        wallet?.walletDvaEnabled === true
      }
      surface={WALLET_FUNDING_TELEMETRY.surfaces.walletPage}
    />
  );
}
