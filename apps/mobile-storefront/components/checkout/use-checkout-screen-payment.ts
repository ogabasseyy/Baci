import type { CheckoutStep } from '@/components/checkout/CheckoutStepper';
import type { useCartStore } from '@/stores/cart-store';
import { calculateCheckoutAssuranceFee } from './checkout-order-builders';
import {
  CHECKOUT_MERCHANT_ID,
  CHECKOUT_MERCHANT_SLUG,
} from './checkout-screen.constants';
import { useCheckoutPaymentController } from './use-checkout-payment-controller';

type CartItems = ReturnType<typeof useCartStore.getState>['items'];

/**
 * Payment-controller wiring for the checkout screen: assurance fee,
 * controller instance, and the controller fields the screen renders.
 * Extracted so CheckoutScreenView stays within the module-size cap.
 */
export function useCheckoutScreenPayment({
  customerId,
  customerPhone,
  deliveryFee,
  isAuthenticated,
  items,
  merchantId,
  step,
  subtotal,
  userId,
}: {
  customerId?: string;
  customerPhone?: string | null;
  deliveryFee: number;
  isAuthenticated: boolean;
  items: CartItems;
  merchantId?: string | null;
  step: CheckoutStep;
  subtotal: number;
  userId?: string;
}) {
  const assuranceFee = calculateCheckoutAssuranceFee(items);
  const paymentController = useCheckoutPaymentController({
    assuranceFee,
    customerId,
    customerPhone,
    deliveryFee,
    isAuthenticated,
    items,
    userId,
    merchantId: merchantId || CHECKOUT_MERCHANT_ID,
    merchantSlug: CHECKOUT_MERCHANT_SLUG,
    step,
    subtotal,
  });
  const {
    availablePaymentMethods,
    displayTotal,
    orderTotals,
    paymentSettings,
    paymentTab,
    resetPaymentSelection,
    savings,
    selectedPayment,
    total,
    walletBalance,
    walletSelection,
  } = paymentController;

  return {
    assuranceFee,
    availablePaymentMethods,
    displayTotal,
    orderTotals,
    paymentController,
    paymentSettings,
    paymentTab,
    resetPaymentSelection,
    savings,
    selectedPayment,
    total,
    walletBalance,
    walletSelection,
  };
}
