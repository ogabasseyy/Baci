import { useEffect, useState } from 'react';
import type { CheckoutStep } from '@/components/checkout/CheckoutStepper';
import { getPaymentTabForMethod } from '@/components/checkout/checkout-step-helpers';
import type {
  PaymentMethodType,
  PaymentTab,
} from '@/components/checkout/PaymentMethodSelector';
import { useCheckoutSavings } from '@/hooks/use-checkout-savings';
import { useWallet } from '@/hooks/use-wallet';
import {
  getEnabledPaymentMethods,
  getMerchantTaxRate,
  useMerchantPaymentSettings,
} from '@/hooks/useMerchantPaymentSettings';
import {
  getKlumpDisabledReason,
  shouldHideKlumpPaymentMethod,
} from '@/lib/klump-checkout';
import { isStoreCreditCompatiblePayment } from '@/lib/store-credit-compatible-payment';
import { calculateCommerce } from '@/lib/supabase';
import type { WalletSelection } from '@/lib/wallet-payment-helpers';
import { getRedvaultPaymentAvailability } from '@/services/redvault';
import type { useCartStore } from '@/stores/cart-store';

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
}: UseCheckoutPaymentControllerParams) {
  const { data: paymentSettings } = useMerchantPaymentSettings();
  const enabledPaymentMethods = getEnabledPaymentMethods(paymentSettings);
  const walletOrderAutoDebitEnabled = Boolean(
    paymentSettings?.paystack_enabled &&
      paymentSettings.wallet_paystack_dva_enabled &&
      paymentSettings.wallet_order_auto_debit_enabled
  );
  const [availability, setAvailability] = useState<{
    merchantId: string;
    available: boolean;
  } | null>(null);
  const redvaultAvailable =
    availability?.merchantId === merchantId && availability.available;
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
  const walletBalance = walletQuery.data?.wallet?.balance ?? 0;

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

  useEffect(() => {
    let active = true;
    void getRedvaultPaymentAvailability(merchantId)
      .then((available) => {
        if (active) setAvailability({ merchantId, available });
      })
      .catch(() => {
        if (active) setAvailability({ merchantId, available: false });
      });
    return () => {
      active = false;
    };
  }, [merchantId]);

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
      walletOrderAutoDebitEnabled,
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
    walletSelection,
  };
}

export type CheckoutPaymentController = ReturnType<
  typeof useCheckoutPaymentController
>;

function isEligibleForWalletFundedBankTransfer({
  customerId,
  customerPhone,
  isAuthenticated,
  residualAfterSavings,
  walletBalance,
  walletOrderAutoDebitEnabled,
}: {
  customerId?: string | null;
  customerPhone?: string | null;
  isAuthenticated: boolean;
  residualAfterSavings: number;
  walletBalance: number;
  walletOrderAutoDebitEnabled: boolean;
}) {
  return (
    walletOrderAutoDebitEnabled &&
    isAuthenticated &&
    Boolean(customerId) &&
    Boolean(customerPhone) &&
    residualAfterSavings > 0 &&
    walletBalance < residualAfterSavings
  );
}
