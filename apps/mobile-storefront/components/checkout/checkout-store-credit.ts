import type { CheckoutStep } from '@/components/checkout/CheckoutStepper';
import type {
  PaymentMethodType,
  PaymentTab,
} from '@/components/checkout/PaymentMethodSelector';
import { isStoreCreditCompatiblePayment } from '@/lib/store-credit-compatible-payment';
import type {
  SavingsSelection,
  WalletSelection,
} from '@/lib/wallet-payment-helpers';
import type { CartItem } from '@/stores/cart-store';

interface ResolveStoreCreditSelectionsParams {
  appliedDiscountCode?: string | null;
  getLiveSavingsSelection: (input: {
    isStoreCreditCompatible: boolean;
    items: CartItem[];
    orderTotal: number;
  }) => SavingsSelection | undefined;
  itemsSnapshot: CartItem[];
  paymentTab: PaymentTab;
  selectedPayment: PaymentMethodType;
  snapshotTotal: number;
  walletBalance: number;
  walletSelection: WalletSelection | undefined;
}

export function resolveCheckoutStoreCreditSelections({
  appliedDiscountCode,
  getLiveSavingsSelection,
  itemsSnapshot,
  paymentTab,
  selectedPayment,
  snapshotTotal,
  walletBalance,
  walletSelection,
}: ResolveStoreCreditSelectionsParams) {
  const isStoreCreditCompatible = isStoreCreditCompatiblePayment({
    paymentTab,
    selectedPayment,
  });
  const liveSavingsSelection = appliedDiscountCode
    ? undefined
    : getLiveSavingsSelection({
        isStoreCreditCompatible,
        items: itemsSnapshot,
        orderTotal: snapshotTotal,
      });
  const liveSavingsAmount = liveSavingsSelection?.amount ?? 0;
  const walletResidualAfterSavings = Math.max(
    snapshotTotal - liveSavingsAmount,
    0
  );
  const liveWalletSelection: WalletSelection | undefined =
    walletSelection?.use === true && isStoreCreditCompatible
      ? {
          use: true,
          amount: Math.max(
            0,
            Math.min(walletBalance, walletResidualAfterSavings)
          ),
        }
      : undefined;

  return { liveSavingsSelection, liveWalletSelection };
}

export function computeCheckoutDisplayAndKlumpGateTotals({
  assuranceFee,
  checkoutSavingsBalance,
  deliveryFee,
  getLiveSavingsSelection,
  items,
  paymentTab,
  savingsSelectionUse,
  selectedPayment,
  step,
  subtotal,
  total,
  walletBalance,
  walletSelection,
}: {
  assuranceFee: number;
  checkoutSavingsBalance: number;
  deliveryFee: number;
  getLiveSavingsSelection: ResolveStoreCreditSelectionsParams['getLiveSavingsSelection'];
  items: CartItem[];
  paymentTab: PaymentTab | null;
  savingsSelectionUse: boolean;
  selectedPayment: PaymentMethodType | null;
  step: CheckoutStep;
  subtotal: number;
  total: number;
  walletBalance: number;
  walletSelection: WalletSelection | undefined;
}) {
  const storeCreditCompatible = isStoreCreditCompatiblePayment({
    paymentTab,
    selectedPayment,
  });
  const liveSavingsSelectionForKlumpGate = getLiveSavingsSelection({
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
    storeCreditCompatible && savingsSelectionUse
      ? Math.min(checkoutSavingsBalance, baseTotal)
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
  const netPayableForKlumpGate = Math.max(
    total -
      (liveWalletSelectionForKlumpGate?.amount ?? 0) -
      (liveSavingsSelectionForKlumpGate?.amount ?? 0),
    0
  );

  return {
    liveSavingsSelectionForKlumpGate,
    liveWalletSelectionForKlumpGate,
    netPayableForKlumpGate,
    stepDisplayTotal,
  };
}
