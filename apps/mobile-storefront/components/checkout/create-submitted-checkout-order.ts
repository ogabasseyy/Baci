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
  }
) {
  const { creditFields, orderRequest } = buildCheckoutSubmitOrderRequest(input);
  // Promotional codes are priced on the server and reduce the financed order total.
  if (input.paymentMethodForOrder === 'oxygen') {
    return {
      creditFields,
      orderResponse: await submitOxygenCheckout({
        request: orderRequest,
        ...options,
      }),
    };
  }
  return {
    creditFields,
    orderResponse: await createOrder(orderRequest, {
      checkoutGeneration: options.checkoutGeneration,
    }),
  };
}
