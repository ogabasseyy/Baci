import type { MutableRefObject } from 'react';
import type { PaymentMethodType } from '@/components/checkout/PaymentMethodSelector';
import type {
  DeliveryMethod,
  ShippingQuote,
} from '@/components/checkout/types';
import type { MobileCheckoutIdempotencyState } from '@/lib/checkout-order-idempotency';
import type { getKlumpDisabledReason } from '@/lib/klump-checkout';
import type { ShippingAddressInput } from '@/lib/validation';
import type {
  SavingsSelection,
  WalletSelection,
} from '@/lib/wallet-payment-helpers';
import type { CartCheckoutBinding } from '@/schemas/cart-checkout-binding';
import type { CreateOrderResult } from '@/services/orders.response';
import type { CartItem } from '@/stores/cart-store';
import { submitBnplCheckout } from './checkout-bnpl-submit';
import type { CheckoutSnapshot } from './checkout-order-builders';
import { createSubmittedCheckoutOrder } from './create-submitted-checkout-order';

interface CreateOrSubmitCheckoutOrderParams {
  address: ShippingAddressInput;
  appliedDiscountCode?: string | null;
  boundItemsSnapshot: CartItem[];
  checkoutGeneration: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  deliveryMethod: DeliveryMethod;
  getShippingProvider: () => string | undefined;
  isAuthenticated: boolean;
  isBNPL: boolean;
  isOrderInFlight: MutableRefObject<boolean>;
  isVoucherOnlyCart: boolean;
  isZeroBalanceOrder: boolean;
  liveSavingsSelection: SavingsSelection | undefined;
  liveWalletSelection: WalletSelection | undefined;
  mobileCheckoutIdempotencyRef: MutableRefObject<MobileCheckoutIdempotencyState | null>;
  onOrderCreated: (orderId: string) => void;
  paymentMethodForOrder: string;
  paymentSettings: Parameters<typeof getKlumpDisabledReason>[0];
  selectedPayment: PaymentMethodType;
  selectedQuote: ShippingQuote | undefined;
  setIsProcessing: (value: boolean) => void;
  sharedCartBinding?: CartCheckoutBinding;
  snapshot: CheckoutSnapshot;
  walletSelection: WalletSelection | undefined;
}

export async function createOrSubmitCheckoutOrder({
  address,
  appliedDiscountCode,
  boundItemsSnapshot,
  checkoutGeneration,
  customerEmail,
  customerName,
  customerPhone,
  deliveryMethod,
  getShippingProvider,
  isAuthenticated,
  isBNPL,
  isOrderInFlight,
  isVoucherOnlyCart,
  isZeroBalanceOrder,
  liveSavingsSelection,
  liveWalletSelection,
  mobileCheckoutIdempotencyRef,
  onOrderCreated,
  paymentMethodForOrder,
  paymentSettings,
  selectedPayment,
  selectedQuote,
  setIsProcessing,
  sharedCartBinding,
  snapshot,
  walletSelection,
}: CreateOrSubmitCheckoutOrderParams): Promise<{
  creditFields: Record<string, unknown>;
  orderResponse: CreateOrderResult;
} | null> {
  if (isBNPL && !isZeroBalanceOrder) {
    const bnplResult = await submitBnplCheckout({
      address,
      appliedDiscountCode,
      checkoutGeneration,
      customerEmail,
      customerName,
      customerPhone,
      deliveryMethod,
      getShippingProvider,
      isOrderInFlight,
      itemsSnapshot: boundItemsSnapshot,
      liveSavingsSelection,
      liveWalletSelection,
      mobileCheckoutIdempotencyRef,
      onOrderCreated,
      paymentMethodForOrder,
      paymentSettings,
      selectedPayment,
      selectedQuote,
      setIsProcessing,
      sharedCartBinding,
      snapshot,
    });
    if (!bnplResult?.fallbackOrderResponse) {
      return null;
    }
    return {
      creditFields: bnplResult.creditFields,
      orderResponse: bnplResult.fallbackOrderResponse,
    };
  }

  const created = await createSubmittedCheckoutOrder(
    {
      address,
      appliedDiscountCode,
      customerEmail,
      customerName,
      customerPhone,
      deliveryMethod,
      itemsSnapshot: boundItemsSnapshot,
      liveSavingsSelection,
      liveWalletSelection,
      paymentMethodForOrder,
      selectedQuote,
      shippingProvider: getShippingProvider(),
      sharedCartBinding,
      snapshot,
    },
    {
      checkoutGeneration,
      hasCredits:
        walletSelection?.use === true || liveSavingsSelection?.use === true,
      hasVoucher: isVoucherOnlyCart,
      isAuthenticated,
    }
  );
  onOrderCreated(created.orderResponse.order.id);
  return created;
}
