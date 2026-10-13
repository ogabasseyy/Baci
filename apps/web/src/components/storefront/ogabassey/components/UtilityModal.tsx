'use client';

import { useState } from 'react';
import { useOptionalCustomerAuth } from '@/contexts/customer-auth-context';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';
import { WALLET_FUNDING_TELEMETRY } from '@/lib/posthog/wallet-funding-events';
import { useWallet } from '@/components/storefront/ogabassey/pages/checkout/hooks/use-wallet';
import { useCustomerFormReset } from './use-customer-form-reset';
import { useUtilityPendingIntent } from './use-utility-pending-intent';
import { useUtilityPurchase } from './use-utility-purchase';
import { AirtimeDataForm } from './utility/AirtimeDataForm';
import { BillPaymentForm } from './utility/BillPaymentForm';
import { UtilityPaymentMethodSelector } from './UtilityPaymentMethodSelector';
import { UtilityWalletFundingPanel } from './UtilityWalletFundingPanel';
import { UtilitySuccessView } from './UtilitySuccessView';
import { UtilityTabs, type UtilityTabId } from './UtilityTabs';
import type { UtilityPaymentMethod } from './utility-types';

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
    payWithWallet,
    refreshWallet,
    requiresFundingAccountConsent,
    setFundingAccount,
    setPayWithWallet,
    setWalletBalance,
    walletBalance,
    walletDvaEnabled,
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
  const [showFundingPanel, setShowFundingPanel] = useState(false);
  const canUseWallet = isAuthenticated && walletBalance > 0;
  // The DVA is the customer's wallet funding account. Offer the action when
  // the merchant supports DVAs and the wallet API says either an account
  // exists or account creation is available; the panel collects a missing
  // phone at the point of need instead of hiding the action.
  const canFundByBankTransfer =
    isAuthenticated &&
    walletDvaEnabled &&
    (Boolean(fundingAccount) || requiresFundingAccountConsent);
  const selectedPaymentMethod: UtilityPaymentMethod =
    canUseWallet && payWithWallet ? 'wallet' : 'card';

  const {
    handleAirtimeDataSubmit,
    handleBillSubmit,
    loading,
    setStep,
    step,
    successAmount,
    transactionRef,
  } = useUtilityPurchase({
    activeTab,
    clearIntent,
    customer,
    isAuthLoading,
    isAuthenticated,
    merchantSlug: merchant?.slug,
    selectedPaymentMethod,
    setWalletBalance,
    user,
    walletBalance,
  });

  // Stable identity of the owned resume draft; null when nothing to resume.
  const intentKey = intent
    ? `${intent.tab}|${intent.amount}|${intent.phoneNumber}|${intent.networkProvider ?? ''}`
    : null;

  // Render-time prev-prop comparison (no stale-frame effect round-trip) that
  // seeds the form. `prevIsOpen` inits `false` so the seed also runs when the
  // modal is rendered already-open (reload / backgrounded-tab eviction — the
  // case the resume feature exists for).
  const [prevIsOpen, setPrevIsOpen] = useState(false);
  const [prevInitialTab, setPrevInitialTab] = useState(initialTab);
  // Owned intent already applied to the form; also part of the form remount key.
  const [appliedIntentKey, setAppliedIntentKey] = useState<string | null>(null);
  // `customer.id` changes on auth hydration (undefined -> defined) AND on an
  // account switch (defined -> defined on the same shared tab). Either re-seeds
  // from the NEW customer's owned intent (below); a switch also bumps
  // `customerEpoch`, which both forms key on so neither carries the previous
  // customer's local draft. A keystroke does NOT change `customer.id`, so
  // reseeds never remount mid-typing (which would drop input focus).
  const customerId = customer?.id;
  const { customerChanged, customerEpoch } = useCustomerFormReset(customerId);
  if (isOpen !== prevIsOpen || initialTab !== prevInitialTab) {
    setPrevIsOpen(isOpen);
    setPrevInitialTab(initialTab);
    if (isOpen) {
      // Land on the tab holding the resumed draft so a `data` draft is not
      // stranded on the default `airtime` tab. `intentKey` may be null until
      // auth hydrates — the customer-change branch below reseeds then.
      setActiveTab(intent?.tab ?? initialTab);
      setStep('details');
      // Collapse the funding panel so reopening never re-triggers DVA
      // auto-create without a fresh "Pay with Bank Transfer" tap.
      setShowFundingPanel(false);
      setAppliedIntentKey(intentKey);
    } else {
      // Re-arm seeding for the next open.
      setAppliedIntentKey(null);
    }
  } else if (isOpen && customerChanged) {
    // Signed-in customer changed while the modal stayed open (auth hydrating,
    // or an account switch). Re-seed for them and remount AirtimeDataForm (its
    // key includes `customerId`): the previous customer's typed phone/amount
    // lives in the form's LOCAL state — which no prop clears without a remount
    // — and must never surface to the next customer.
    setActiveTab(intent?.tab ?? initialTab);
    setStep('details');
    setAppliedIntentKey(intentKey);
  }

  // Collapse the funding panel if the signed-in customer OR the storefront
  // merchant changes while the modal stays mounted — a previous session's
  // open bank-transfer panel (with its DVA account number) must not carry
  // over to a different customer or merchant.
  const fundingIdentity = `${user?.id ?? ''}:${merchant?.slug ?? ''}`;
  const [prevFundingIdentity, setPrevFundingIdentity] =
    useState(fundingIdentity);
  if (fundingIdentity !== prevFundingIdentity) {
    setPrevFundingIdentity(fundingIdentity);
    setShowFundingPanel(false);
  }

  const handleSelectPaymentMethod = (method: UtilityPaymentMethod) => {
    captureClientEvent(
      WALLET_FUNDING_TELEMETRY.events.paymentMethodSelected,
      {
        method,
        wallet_balance: walletBalance,
        can_use_wallet: canUseWallet,
        merchant_slug: merchant?.slug,
        customer_id: customer?.id,
      }
    );
    setPayWithWallet(method === 'wallet');
  };

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
          onSelect={(tab) => {
            setActiveTab(tab);
            setStep('details');
          }}
        />

        <div className="p-6">
          {step === 'success' ? (
            <UtilitySuccessView
              activeTab={activeTab}
              amount={successAmount}
              onClose={handleClose}
              reference={transactionRef}
            />
          ) : (
            <>
              <UtilityPaymentMethodSelector
                canUseWallet={canUseWallet}
                isLoading={loading}
                onFundWallet={
                  canFundByBankTransfer
                    ? () => setShowFundingPanel((visible) => !visible)
                    : undefined
                }
                onSelectCard={() => handleSelectPaymentMethod('card')}
                onSelectWallet={() => handleSelectPaymentMethod('wallet')}
                selectedPaymentMethod={selectedPaymentMethod}
                showWalletRow={isAuthenticated}
                walletBalance={walletBalance}
                walletLoading={walletLoading}
              />
              {showFundingPanel && canFundByBankTransfer ? (
                <UtilityWalletFundingPanel
                  account={fundingAccount}
                  autoCreate
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
                    setShowFundingPanel(false);
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
          )}
        </div>
      </div>
    </div>
  );
};
