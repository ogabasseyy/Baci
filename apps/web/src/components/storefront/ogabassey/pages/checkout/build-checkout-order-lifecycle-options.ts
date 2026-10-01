import type { CheckoutOrderLifecycleOptions } from './handlers/checkout-order-lifecycle';
import type { PrepareCheckoutOrderSubmissionResult } from './prepare-checkout-order-submission';
import type { CartItem } from '@/hooks/cart';
import { buildCheckoutOrderRequest } from './build-checkout-order-request';
import { getForwardableSelectedQuoteId } from './utils';
import { selectRejectedVoucherLines } from './select-rejected-voucher-lines';
import type { DeliveryMethod, PaymentMethod } from './types';

type PreparedCheckoutSubmission = Extract<
  PrepareCheckoutOrderSubmissionResult,
  { kind: 'ready' }
>;

interface CheckoutOrderState {
  pendingOrder: CheckoutOrderLifecycleOptions['reuse']['pendingOrder'];
  merchant: { id: string; slug?: string };
  customer: {
    email: string;
    phone: string;
    name: string;
    firstName: string;
    lastName: string;
    userId?: string;
  };
  newsletterOptIn: boolean;
  paymentMethod: PaymentMethod;
  total: number;
  orderRequestSubtotal: number;
  subtotal: number;
  shipping: number;
  tax: number;
  giftWrappingCost: number;
  discountAmount: number;
  discountCode?: string | null;
  useWalletCredit: boolean;
  walletAmountUsed: number;
  currency: string;
  deliveryMethod: DeliveryMethod;
  airportType: 'delivery' | 'pickup';
  selectedQuoteId: string;
  selectedQuoteMatchesMethod: boolean;
  merchantCountry: string;
};

interface CheckoutOrderActions {
  getIdempotencyKey: () => Promise<string>;
  cart: CartItem[];
  removeFromCart: (cartItemId: string, variantId?: string) => void;
  clearPendingCheckoutOrder: () => void;
  clearCheckoutIdempotencyKey: () => Promise<void>;
  onShippingRateRejected: () => void;
  getOrderErrorMessage: CheckoutOrderLifecycleOptions['submit']['getOrderErrorMessage'];
  waitForResolvedCustomerAuth: () => Promise<boolean>;
  isOrderInFlightRef: { current: boolean };
  setIsProcessing: (value: boolean) => void;
  setRedvaultStatus: CheckoutOrderLifecycleOptions['recoveryContext']['setRedvaultStatus'];
  clearCheckoutSession: () => void;
  clearCart: () => void;
  pushSuccessRoute: (path: string) => void;
  onRedvaultSummary: CheckoutOrderLifecycleOptions['onRedvaultSummary'];
  onOrderCreated: CheckoutOrderLifecycleOptions['onOrderCreated'];
  onPendingSnapshot: CheckoutOrderLifecycleOptions['onPendingSnapshot'];
  setRedvaultOrderReady: CheckoutOrderLifecycleOptions['redvaultReview']['setReady'];
  releaseSubmission: () => void;
}

interface RedvaultReviewState {
  enabled: boolean;
  customerName: string;
}

export interface BuildCheckoutOrderLifecycleOptionsInput {
  prepared: PreparedCheckoutSubmission;
  state: CheckoutOrderState;
  actions: CheckoutOrderActions;
  redvault: RedvaultReviewState;
}

/** Build the order/recovery contract from the frozen preflight result and current checkout state. */
export function buildCheckoutOrderLifecycleOptions({
  prepared,
  state,
  actions,
  redvault,
}: BuildCheckoutOrderLifecycleOptionsInput): CheckoutOrderLifecycleOptions {
  const { delivery, identity } = prepared;
  const { finalAddress, finalCity, finalState } = delivery;

  return {
    reuse: {
      pendingOrder: state.pendingOrder,
      merchantId: state.merchant.id,
      merchantSlug: state.merchant.slug,
      customerEmail: state.customer.email,
      checkoutFingerprint: identity.checkoutFingerprint,
      paymentMethod: identity.normalizedPaymentMethod,
      shippingProvider: delivery.shippingProvider,
      selectedQuoteId: getForwardableSelectedQuoteId(
        state.deliveryMethod,
        state.selectedQuoteId,
        state.selectedQuoteMatchesMethod
      ),
      shippingRateId: delivery.merchantRateId ?? undefined,
    },
    recoveryContext: {
      firstName: state.customer.firstName,
      lastName: state.customer.lastName,
      customerPhone: state.customer.phone,
      finalAddress,
      finalCity,
      finalState,
      merchantCountry: state.merchantCountry,
      waitForResolvedStorefrontCustomerAuth: actions.waitForResolvedCustomerAuth,
      isOrderInFlightRef: actions.isOrderInFlightRef,
      setIsProcessing: actions.setIsProcessing,
      setRedvaultStatus: actions.setRedvaultStatus,
      clearPendingCheckoutOrder: actions.clearPendingCheckoutOrder,
      clearCheckoutSession: actions.clearCheckoutSession,
      clearCart: actions.clearCart,
      pushSuccessRoute: actions.pushSuccessRoute,
    },
    submit: {
      getIdempotencyKey: actions.getIdempotencyKey,
      orderRequest: buildCheckoutOrderRequest({
        merchantId: state.merchant.id,
        items: identity.items,
        paymentMethod: identity.normalizedPaymentMethod,
        acceptsMarketing: state.newsletterOptIn,
        customer: {
          name: state.customer.name,
          email: state.customer.email,
          phone: state.customer.phone,
          userId: state.customer.userId,
        },
        money: {
          subtotal: state.orderRequestSubtotal,
          shipping: state.shipping,
          tax: state.tax,
          giftWrapping: state.giftWrappingCost,
          discountAmount: state.discountAmount,
          discountCode: state.discountCode,
          useWalletCredit: state.useWalletCredit,
          walletAmount: state.walletAmountUsed,
        },
        delivery: {
          method: state.deliveryMethod,
          airportType: state.airportType,
          quoteMatchesMethod: state.selectedQuoteMatchesMethod,
          selectedQuoteId: state.selectedQuoteId,
          merchantRateId: delivery.merchantRateId,
          provider: delivery.shippingProvider,
          address: delivery.address,
        },
      }),
      paymentMethod: state.paymentMethod,
      total: state.total,
      onVoucherRejected: (errorData) => {
        for (const line of selectRejectedVoucherLines(actions.cart, errorData)) {
          if (line.cartItemId) {
            actions.removeFromCart(line.cartItemId);
          } else {
            actions.removeFromCart(line.id, line.variantId);
          }
        }
      },
      onPendingOrderInvalidated: async () => {
        actions.clearPendingCheckoutOrder();
        await actions.clearCheckoutIdempotencyKey();
      },
      onShippingRateRejected: actions.onShippingRateRejected,
      getOrderErrorMessage: actions.getOrderErrorMessage,
    },
    customer: {
      email: state.customer.email,
      phone: state.customer.phone,
      merchantId: state.merchant.id,
    },
    fingerprint: identity.checkoutFingerprint,
    paymentMethod: state.paymentMethod,
    itemCount: identity.items.reduce((count, item) => count + item.quantity, 0),
    shipping: state.shipping,
    subtotal: state.subtotal,
    tax: state.tax,
    fallbackTotal: state.total,
    currencyFallback: state.currency,
    shippingAddress: {
      address: finalAddress,
      city: finalCity,
      state: finalState,
    },
    merchantCountry: state.merchantCountry,
    onRedvaultSummary: actions.onRedvaultSummary,
    onOrderCreated: actions.onOrderCreated,
    onPendingSnapshot: actions.onPendingSnapshot,
    redvaultReview: {
      enabled: redvault.enabled,
      customerName: redvault.customerName,
      checkoutFingerprint: identity.checkoutFingerprint,
      setReady: actions.setRedvaultOrderReady,
      releaseSubmission: actions.releaseSubmission,
    },
  };
}
