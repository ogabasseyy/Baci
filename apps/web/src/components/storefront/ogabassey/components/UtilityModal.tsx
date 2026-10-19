'use client';

import { useState } from 'react';
import { useOptionalCustomerAuth } from '@/contexts/customer-auth-context';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { WALLET_FUNDING_TELEMETRY } from '@/lib/posthog/wallet-funding-events';
import { useWallet } from '@/components/storefront/ogabassey/pages/checkout/hooks/use-wallet';
import { useCustomerFormReset } from './use-customer-form-reset';
import { useUtilityModalFormSeeding } from './use-utility-modal-seeding';
import { useUtilityFundingPanel } from './use-utility-funding-panel';
import { useUtilityPendingIntent } from './use-utility-pending-intent';
import { useUtilityPurchase } from './use-utility-purchase';
import { useUtilityRetainedSettlement } from './use-utility-retained-settlement';
import { AirtimeDataForm } from './utility/AirtimeDataForm';
import { BillPaymentForm } from './utility/BillPaymentForm';
import { UtilityPaymentMethodSelector } from './UtilityPaymentMethodSelector';
import { createSelectWalletHandler } from './utility-wallet-selection';
import { UtilityWalletFundingPanel } from './UtilityWalletFundingPanel';
import { UtilitySuccessView } from './UtilitySuccessView';
import { UtilityTabs, type UtilityTabId } from './UtilityTabs';

interface UtilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'airtime' | 'data' | 'tv' | 'power' | 'betting';
}

export const UtilityModal = ({
  isOpen,
  onClose,
  initialTab = 'airtime',
}: UtilityModalProps) => {
  const [activeTab, setActiveTab] = useState<UtilityTabId>(initialTab);

  const merchantContext = useMerchantSafe();
  const merchant = merchantContext?.merchant;
  const auth = useOptionalCustomerAuth();
  const customer = auth?.customer ?? null;
  const isAuthenticated = auth?.isAuthenticated ?? false;
  const isAuthLoading = auth?.isLoading ?? false;
  const user = auth?.user ?? null;
  const {
    fundingAccount,
    getWalletBalance,
    getWalletError,
    isWalletRefreshPending,
    isWalletInitialReadPending,
    refreshWallet,
    requiresFundingAccountConsent,
    setFundingAccount,
    setPayWithWallet,
    setWalletBalance,
    payWithWallet,
    walletBalance,
    walletDvaEnabled,
    walletError,
    walletLoading,
    walletTransactions,
  } = useWallet({
    merchantSlug: merchant?.slug,
    userId: user?.id,
  });
  // Pending intent survives a bank-transfer funding detour.
  const { clearIntent, intent, saveIntent } = useUtilityPendingIntent(
    customer?.id
  );
  const canUseWallet = isAuthenticated && walletBalance > 0;
  const {
    canFundByBankTransfer,
    closeFundingPanel,
    fundingPanelAutoCreate,
    openForInsufficientBalance,
    showFundingPanel,
    toggleFromExplicitChoice,
  } = useUtilityFundingPanel({
    fundingAccount,
    isAuthenticated,
    merchantSlug: merchant?.slug,
    requiresFundingAccountConsent,
    userId: user?.id,
    walletDvaEnabled,
  });
  const {
    handleAirtimeDataSubmit,
    handleBillSubmit,
    loading,
    setStep,
    settleBackfilledAttempt,
    step,
    submitting,
    successAmount,
    transactionRef,
    transactionVoucherPin,
  } = useUtilityPurchase({
    activeTab,
    canFundByBankTransfer,
    clearIntent,
    customer,
    isAuthLoading,
    isAuthenticated,
    merchantId: merchant?.id,
    merchantSlug: merchant?.slug,
    onInsufficientWalletBalance: openForInsufficientBalance,
    isWalletRefreshPending,
    isWalletInitialReadPending,
    getWalletBalance,
    getWalletError,
    refreshWallet,
    setWalletBalance,
    user,
    walletLoading,
  });

  // `customer.id` changes on auth hydration (undefined -> defined) AND on an
  // account switch (defined -> defined on the same shared tab). Either re-seeds
  // from the NEW customer's owned intent; a switch also bumps
  // `customerEpoch`, which both forms key on so neither carries the previous
  // customer's local draft. A keystroke does NOT change `customer.id`, so
  // reseeds never remount mid-typing (which would drop input focus).
  // Settle retained idempotency entries whose rows reached terminality
  // after the backfill stopped polling, before the customer can repeat
  // (Codex R57 6rseWu). No-op without retained references.
  useUtilityRetainedSettlement({
    enabled: isOpen,
    merchantSlug: merchant?.slug,
    // Same pair the idempotency scope hashed (Codex R62 6rtokd).
    scopeMerchantId: merchant?.id,
    scopeOwnerId: user?.id ?? customer?.id,
    userId: user?.id,
  });

  const customerId = customer?.id;
  const { customerChanged, customerEpoch } = useCustomerFormReset(customerId);
  const { appliedIntentKey } = useUtilityModalFormSeeding({
    closeFundingPanel,
    customerChanged,
    initialTab,
    intent,
    isOpen,
    setActiveTab,
    setStep,
  });

  const handleSelectWallet = createSelectWalletHandler({
    canUseWallet,
    customerId: customer?.id,
    merchantSlug: merchant?.slug,
    setPayWithWallet,
    walletBalance,
  });

  const handleClose = () => {
    // A deliberate close abandons the draft: drop the persisted resume snapshot
    // so an abandoned form is not silently restored into a later purchase.
    // (Reload / tab-eviction — the resume path — never runs this handler.)
    clearIntent();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="bg-gray-50 px-6 py-4 flex items-center justify-between border-b border-gray-100">
          <h3 className="font-bold text-lg text-gray-900">Utility Payment</h3>
          <button type="button"
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <span className="sr-only">Close</span>
            <svg
              width="24"
              height="24"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <UtilityTabs
          activeTab={activeTab}
          // Lock tabs in flight AND on the result views: loading flips
          // false while step is still 'processing', and a switch there
          // unmounts the settlement poll (key never settles, wallet never
          // refetches, late token/refund never surfaces). `submitting`
          // covers the pre-loading settle await, when loading is still
          // false but the original tab's charge is already committed.
          disabled={loading || submitting || step !== 'details'}
          onSelect={(tab) => {
            // Belt-and-braces with `disabled` (native disabled is not
            // enforced on programmatic/assisted activation paths): a
            // switch off the result views must never unmount the poll.
            if (step !== 'details' || submitting) {
              return;
            }
            setActiveTab(tab);
            setStep('details');
          }}
        />

        <div className="p-6">
          {step === 'details' ? (
            <>
              <UtilityPaymentMethodSelector
                canUseWallet={canUseWallet}
                isLoading={loading}
                onFundWallet={
                  canFundByBankTransfer ? toggleFromExplicitChoice : undefined
                }
                onSelectWallet={handleSelectWallet}
                showWalletRow={isAuthenticated}
                walletBalance={walletBalance}
                walletError={walletError}
                walletLoading={walletLoading}
                walletSelected={payWithWallet}
              />
              {showFundingPanel && canFundByBankTransfer ? (
                <UtilityWalletFundingPanel
                  account={fundingAccount}
                  autoCreate={fundingPanelAutoCreate}
                  customerId={customer?.id}
                  customerFirstName={customer?.first_name ?? null}
                  customerLastName={customer?.last_name ?? null}
                  customerPhone={customer?.phone ?? null}
                  merchantSlug={merchant?.slug}
                  onAccountCreated={setFundingAccount}
                  onRefreshBalance={refreshWallet}
                  onReturnToPurchase={() => {
                    // Prefill-only resume: collapse the funding panel and
                    // preselect the wallet. The customer still presses Pay.
                    closeFundingPanel();
                    setPayWithWallet(true);
                  }}
                  requiresConsent={requiresFundingAccountConsent}
                  surface={WALLET_FUNDING_TELEMETRY.surfaces.utilityModal}
                  walletTransactions={walletTransactions}
                />
              ) : null}
              {(activeTab === 'airtime' || activeTab === 'data') && (
                <AirtimeDataForm
                  // Remount on tab change, on a customer switch (`customerEpoch`),
                  // and when a late-hydrating intent seeds. AirtimeDataForm reads
                  // `initialDraft` only on mount and keeps the typed draft in
                  // local state, so a shared instance would misfire a resumed
                  // draft or leak the prior customer's phone/amount to the next.
                  key={`${activeTab}|${customerEpoch}|${appliedIntentKey ?? ''}`}
                  type={activeTab}
                  loading={loading}
                  initialDraft={
                    intent?.tab === activeTab ? intent : undefined
                  }
                  onDraftChange={(draft) =>
                    saveIntent({ ...draft, tab: activeTab })
                  }
                  onSubmit={handleAirtimeDataSubmit}
                />
              )}
              {(activeTab === 'tv' ||
                activeTab === 'power' ||
                activeTab === 'betting') && (
                <BillPaymentForm
                  // Remount on a customer switch so the previous customer's typed
                  // meter/smartcard/betting id, amount, biller and VERIFIED
                  // account-holder address (all in the form's local state) never
                  // surface to the next customer on a shared tab.
                  key={`${activeTab}|${customerEpoch}`}
                  type={activeTab}
                  loading={loading}
                  onSubmit={handleBillSubmit}
                />
              )}
            </>
          ) : (
            <UtilitySuccessView
              activeTab={activeTab}
              amount={successAmount}
              merchantSlug={merchant?.slug}
              onClose={handleClose}
              onSettled={settleBackfilledAttempt}
              processing={step === 'processing'}
              reference={transactionRef}
              voucherPin={transactionVoucherPin}
            />
          )}
        </div>
      </div>
    </div>
  );
};
