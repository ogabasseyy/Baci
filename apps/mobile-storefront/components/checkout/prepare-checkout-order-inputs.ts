import type {
  PaymentMethodType,
  PaymentTab,
} from '@/components/checkout/PaymentMethodSelector';
import type {
  SavingsSelection,
  WalletSelection,
} from '@/lib/wallet-payment-helpers';
import { trackCheckoutStep } from '@/services/analytics';
import type { CartItem } from '@/stores/cart-store';
import { abortIfCartPricesStale } from './abort-if-cart-prices-stale';
import {
  type CheckoutSnapshot,
  createCheckoutSnapshot,
} from './checkout-order-builders';
import { resolveCheckoutStoreCreditSelections } from './checkout-store-credit';
import type { UseCheckoutSubmitParams } from './use-checkout-submit.types';

interface PrepareCheckoutOrderInputsParams
  extends Pick<
    UseCheckoutSubmitParams,
    | 'deliveryFee'
    | 'getLiveSavingsSelection'
    | 'orderTotals'
    | 'paymentTab'
    | 'selectedPayment'
    | 'walletBalance'
    | 'walletSelection'
  > {
  isVoucherOnlyCart: boolean;
  itemsSnapshot: CartItem[];
  merchantId: string;
  paymentTab: PaymentTab;
  selectedPayment: PaymentMethodType;
}

export interface PreparedCheckoutOrderInputs {
  liveSavingsSelection: SavingsSelection | undefined;
  liveWalletSelection: WalletSelection | undefined;
  paymentMethodForOrder: PaymentMethodType | 'card';
  snapshot: CheckoutSnapshot;
}

/**
 * Fresh-price gate plus snapshot/store-credit preparation for the order
 * request. Returns null when the cart went stale (the submit aborts)
 * instead of throwing, so the caller keeps its single early return.
 */
export async function prepareCheckoutOrderInputs({
  deliveryFee,
  getLiveSavingsSelection,
  isVoucherOnlyCart,
  itemsSnapshot,
  merchantId,
  orderTotals,
  paymentTab,
  selectedPayment,
  walletBalance,
  walletSelection,
}: PrepareCheckoutOrderInputsParams): Promise<PreparedCheckoutOrderInputs | null> {
  if (await abortIfCartPricesStale(itemsSnapshot, merchantId)) {
    return null;
  }
  const snapshot = createCheckoutSnapshot(
    itemsSnapshot,
    deliveryFee,
    orderTotals?.taxAmount ?? 0
  );
  const { liveSavingsSelection, liveWalletSelection } =
    resolveCheckoutStoreCreditSelections({
      getLiveSavingsSelection,
      itemsSnapshot,
      paymentTab,
      selectedPayment,
      snapshotTotal: snapshot.total,
      walletBalance,
      walletSelection,
    });
  trackCheckoutStep('review');
  // A voucher-only cart is a ₦0 prize: force a non-POD method so the voucher
  // RPC marks the pre-reserved order paid (it keys payment_status off
  // p_payment_method — 'pod'/'pay_on_delivery' → pending, else → paid). With
  // POD the prize order would be left pending while the cart is cleared.
  // Pay-for-me keeps its own persisted identity (like web checkout):
  // collapsing it to 'invoice' would misclassify its documents as
  // proforma. The server defaults it to pending, matching invoice flow.
  const paymentMethodForOrder = isVoucherOnlyCart ? 'card' : selectedPayment;
  return {
    liveSavingsSelection,
    liveWalletSelection,
    paymentMethodForOrder,
    snapshot,
  };
}
