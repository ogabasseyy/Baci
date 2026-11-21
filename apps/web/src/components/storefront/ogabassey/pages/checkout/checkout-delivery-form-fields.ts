import type { useCheckoutFormSession } from './hooks/use-checkout-form-session';

export function checkoutDeliveryFormFields(
  checkoutForm: ReturnType<typeof useCheckoutFormSession>['form']['values']
) {
  return {
    airportRequiresQuote: checkoutForm.airportRequiresQuote,
    airportType: checkoutForm.airportType,
    deliveryCoordinates: checkoutForm.deliveryCoordinates,
    persistedSelectedQuoteId: checkoutForm.selectedQuoteId,
    persistedSelectedProviderRateId: checkoutForm.selectedProviderRateId,
    deliveryMethod: checkoutForm.deliveryMethod,
    newAddressStreet: checkoutForm.newAddressStreet,
    newAddressState: checkoutForm.newAddressState,
    newAddressCity: checkoutForm.newAddressCity,
    customerPhone: checkoutForm.customerPhone,
    firstName: checkoutForm.firstName,
    lastName: checkoutForm.lastName,
    customerEmail: checkoutForm.customerEmail,
  };
}
