import { createOrder } from '@/services/orders';
import { submitOxygenCheckout } from './checkout-oxygen-submit';
import {
  buildCheckoutSubmitOrderRequest,
  type CheckoutSubmitOrderRequestInput,
} from './checkout-submit-order-request';
/** One durable order identity is shared by ordinary checkout and native Oxygen. */
export async function createSubmittedCheckoutOrder(
  input: CheckoutSubmitOrderRequestInput,
  options: {
    checkoutGeneration: string;
    isAuthenticated: boolean;
    hasVoucher: boolean;
    hasCredits: boolean;
    onOrderCreated: (orderId: string) => void;
  }
) {
  const { creditFields, orderRequest } = buildCheckoutSubmitOrderRequest(input);
  if (input.paymentMethodForOrder === 'oxygen') {
    await submitOxygenCheckout({ request: orderRequest, ...options });
    return { creditFields, orderResponse: null };
  }
  return {
    creditFields,
    orderResponse: await createOrder(orderRequest, {
      checkoutGeneration: options.checkoutGeneration,
    }),
  };
}
