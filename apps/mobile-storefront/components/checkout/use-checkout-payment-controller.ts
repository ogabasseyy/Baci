import { useEffect, useState } from 'react';
import type { CheckoutStep } from '@/components/checkout/CheckoutStepper';
import { getPaymentTabForMethod } from '@/components/checkout/checkout-step-helpers';
import type {
  PaymentMethodType,
  PaymentTab,
} from '@/components/checkout/PaymentMethodSelector';
import { useCheckoutSavings } from '@/hooks/use-checkout-savings';
import { usePiggyvestPossible } from '@/hooks/use-piggyvest-possible';
import { useWallet } from '@/hooks/use-wallet';
import {
  getEnabledPaymentMethods,
  getMerchantTaxRate,
  useMerchantPaymentSettings,
} from '@/hooks/useMerchantPaymentSettings';
import { calculateCommerce } from '@/lib/commerce-brain';
import { isWalletPrimaryUnknown } from '@/lib/is-wallet-primary-unknown';
import {
  getKlumpDisabledReason,
  shouldHideKlumpPaymentMethod,
} from '@/lib/klump-checkout';
import { isStoreCreditCompatiblePayment } from '@/lib/store-credit-compatible-payment';
import type { WalletSelection } from '@/lib/wallet-payment-helpers';
import { isWalletStoreCredit } from '@/lib/wallet-store-credit';
import type { useCartStore } from '@/stores/cart-store';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { isEligibleForWalletFundedBankTransfer } from './is-eligible-for-wallet-funded-bank-transfer';
import { isLiveWalletTransferHeld } from './is-live-wallet-transfer-held';
import { useRedvaultAvailability } from './use-redvault-availability';

type CartItems = ReturnType<typeof useCartStore.getState>['items'];

interface UseCheckoutPaymentControllerParams {
  assuranceFee: number;
  customerId?: string;
  customerPhone?: string | null;
  deliveryFee: number;
  isAuthenticated: boolean;
  items: CartItems;
  merchantId: string;
  merchantSlug: string;
  step: CheckoutStep;
  subtotal: number;
  userId?: string;
}

export function useCheckoutPaymentController({
  assuranceFee,
  customerId,
  customerPhone,
  deliveryFee,
  isAuthenticated,
  items,
  merchantId,
  merchantSlug,
  step,
  subtotal,
  userId,
}: UseCheckoutPaymentControllerParams) {
  const { data: paymentSettings } = useMerchantPaymentSettings();
  const enabledPaymentMethods = getEnabledPaymentMethods(paymentSettings);
  const walletOrderAutoDebitEnabled = Boolean(
    paymentSettings?.paystack_enabled &&
      paymentSettings.wallet_paystack_dva_enabled &&
      paymentSettings.wallet_order_auto_debit_enabled
  );
  const redvaultAvailability = useRedvaultAvailability({
    assuranceFee,
    customerId,
    deliveryFee,
    isAuthenticated,
    items,
    merchantId,
    userId,
  });
  // Bound shared-cart orders have no REDVAULT path; offering it only
  // defers a deterministic server rejection to submit time.
  const sharedCartEnabled = useNativeSharedCartStore((state) => state.enabled);
  const redvaultAvailable = redvaultAvailability && !sharedCartEnabled;
  const availablePaymentMethods: PaymentMethodType[] = Array.from(
    new Set<PaymentMethodType>([
      ...enabledPaymentMethods,
      ...(redvaultAvailable ? ['uba_redvault' as const] : []),
      'invoice',
      'payforme',
    ])
  );
  const [selectedPayment, setSelectedPaymentState] =
    useState<PaymentMethodType | null>(null);
  const [paymentTab, setPaymentTab] = useState<PaymentTab | null>(null);
  const [walletSelection, setWalletSelection] = useState<
    WalletSelection | undefined
  >(undefined);
  const [orderTotals, setOrderTotals] = useState<{
    total: number;
    taxAmount: number;
  } | null>(null);
  const savings = useCheckoutSavings({
    customerId,
    isAuthenticated,
    items,
    merchantId,
    merchantSlug,
  });
  const walletQuery = useWallet();
  // Orders spend the older balance: store credit for PiggyVest customers.
  const walletBalance = walletQuery.data?.wallet?.balance ?? 0;
  const walletIsStoreCredit = isWalletStoreCredit(walletQuery.data?.wallet);
  const piggyvestPossible = usePiggyvestPossible(merchantId);

  const handleSelectPaymentTab = (tab: PaymentTab) => {
    setPaymentTab(tab);
    if (selectedPayment && getPaymentTabForMethod(selectedPayment) !== tab) {
      setSelectedPaymentState(null);
    }
  };

  const handleSelectPaymentMethod = (method: PaymentMethodType) => {
    setSelectedPaymentState(method);
    setPaymentTab(getPaymentTabForMethod(method));
  };

  const resetPaymentSelection = () => {
    setSelectedPaymentState(null);
    setPaymentTab(null);
  };

  // Render-phase adjustment (react.dev "adjusting state when a prop
  // changes"): every branch converges, so React settles on a valid
  // payment selection before commit instead of flashing a stale frame
  // through an effect.
  const currentTabMethods = availablePaymentMethods.filter(
    (method) => paymentTab && getPaymentTabForMethod(method) === paymentTab
  );
  if (
    selectedPayment &&
    selectedPayment !== 'uba_redvault' &&
    !availablePaymentMethods.includes(selectedPayment)
  ) {
    setSelectedPaymentState(null);
  } else if (selectedPayment === 'uba_redvault' && !redvaultAvailable) {
    setSelectedPaymentState(null);
  } else if (
    selectedPayment &&
    paymentTab !== getPaymentTabForMethod(selectedPayment)
  ) {
    setPaymentTab(getPaymentTabForMethod(selectedPayment));
  } else if (paymentTab && currentTabMethods.length === 0) {
    setPaymentTab(null);
  }

  useEffect(() => {
    const fetchTotals = async () => {
      try {
        const taxRate = getMerchantTaxRate(paymentSettings);
        const result = await calculateCommerce('calculate_order', {
          subtotal,
          shippingFee: deliveryFee,
          taxRate,
          assuranceFee,
        });
        setOrderTotals(result);
      } catch {
        // Totals fall back to local arithmetic below.
      }
    };
    fetchTotals();
  }, [subtotal, deliveryFee, paymentSettings, assuranceFee]);

  const taxAmount = orderTotals?.taxAmount ?? 0;
  const total =
    orderTotals?.total ?? subtotal + deliveryFee + assuranceFee + taxAmount;
  const liveSavingsSelectionForWalletFundedBankTransfer =
    savings.getLiveSavingsSelection({
      isStoreCreditCompatible: true,
      items,
      orderTotal: total,
    });
  const walletFundedBankTransferResidual = Math.max(
    total - (liveSavingsSelectionForWalletFundedBankTransfer?.amount ?? 0),
    0
  );
  const walletFundedBankTransferOptionEnabled =
    isEligibleForWalletFundedBankTransfer({
      customerId,
      customerPhone,
      isAuthenticated,
      residualAfterSavings: walletFundedBankTransferResidual,
      walletBalance,
      walletIsStoreCredit,
      walletOrderAutoDebitEnabled,
      // Where PiggyVest is possible, not loaded, refreshing or a failed
      // refresh (stale data) counts as unknown (Codex): a PiggyVest customer
      // must never pick this before the wallet says which kind it is.
      // Merchants the server rules out keep today's behaviour (Muse).
      walletPrimaryUnknown:
        isWalletPrimaryUnknown(walletQuery.data?.wallet) ||
        (piggyvestPossible &&
          (!walletQuery.data?.wallet ||
            walletQuery.data.wallet.owner_unresolved === true ||
            walletQuery.isRefetching ||
            walletQuery.isError)),
    });
  const storeCreditCompatible = isStoreCreditCompatiblePayment({
    paymentTab,
    selectedPayment,
  });
  const liveSavingsSelectionForKlumpGate = savings.getLiveSavingsSelection({
    isStoreCreditCompatible: storeCreditCompatible,
    items,
    orderTotal: total,
  });
  const walletResidualForKlumpGate = Math.max(
    total - (liveSavingsSelectionForKlumpGate?.amount ?? 0),
    0
  );
  const liveWalletSelectionForKlumpGate: WalletSelection | undefined =
    walletSelection?.use === true && storeCreditCompatible
      ? {
          use: true,
          amount: Math.max(
            0,
            Math.min(walletBalance, walletResidualForKlumpGate)
          ),
        }
      : undefined;

  const baseTotal =
    step === 'review' ? total : subtotal + deliveryFee + assuranceFee;
  const activeSavings =
    storeCreditCompatible && savings.savingsSelection?.use === true
      ? Math.min(savings.checkoutSavingsBalance, baseTotal)
      : 0;
  const baseResidualAfterSavings = Math.max(baseTotal - activeSavings, 0);
  const activeWallet =
    storeCreditCompatible && walletSelection?.use === true
      ? Math.min(walletBalance, baseResidualAfterSavings)
      : 0;
  const stepDisplayTotal = Math.max(
    baseTotal - activeSavings - activeWallet,
    0
  );

  return {
    availablePaymentMethods,
    displayTotal: stepDisplayTotal,
    handleSelectPaymentTab,
    hiddenPaymentMethods: shouldHideKlumpPaymentMethod(paymentSettings, total)
      ? (['klump'] satisfies PaymentMethodType[])
      : [],
    klumpDisabledReason: getKlumpDisabledReason(
      paymentSettings,
      total,
      liveWalletSelectionForKlumpGate,
      liveSavingsSelectionForKlumpGate
    ),
    orderTotals,
    paymentSettings,
    paymentTab,
    redvaultAvailable,
    resetPaymentSelection,
    savings,
    selectedPayment,
    setSelectedPayment: handleSelectPaymentMethod,
    setWalletSelection,
    total,
    walletBalance,
    walletFundedBankTransferOptionEnabled,
    // Live re-check at submit: a refresh may land as PiggyVest mid-submit.
    isWalletFundedBankTransferHeld: () =>
      isLiveWalletTransferHeld(walletQuery, piggyvestPossible),
    walletIsStoreCredit,
    walletSelection,
  };
}

export type CheckoutPaymentController = ReturnType<
  typeof useCheckoutPaymentController
>;
