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
