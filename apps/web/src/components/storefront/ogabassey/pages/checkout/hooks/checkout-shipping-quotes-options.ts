import type { SavedCheckoutAddress } from '../components/DeliveryAddressFields';
import type { loadCheckoutShippingQuotes } from './checkout-shipping-quote-loader';
import type { useCheckoutFormState } from './use-checkout-form-state';

type CheckoutForm = ReturnType<typeof useCheckoutFormState>;
type Values = CheckoutForm['values'];

export interface CheckoutShippingQuotesOptions {
  isHydrated: boolean;
  merchantId?: string;
  merchantCountry: string;
  checkoutCart: Parameters<typeof loadCheckoutShippingQuotes>[1];
  checkoutCartCatalogSubtotal: number;
  quoteItemsFingerprint: string;
  deliveryCoordinates: Values['deliveryCoordinates'];
  persistedSelectedQuoteId: string;
  persistedSelectedProviderRateId: string;
  currentStep: Values['currentStep'];
  setCurrentStep: (step: Values['currentStep']) => void;
  setCheckoutField: CheckoutForm['setValue'];
  setCheckoutFields: CheckoutForm['setValues'];
  setDeliveryMethod: (method: Values['deliveryMethod']) => void;
  deliveryMethod: Values['deliveryMethod'];
  newAddressStreet: string;
  newAddressState: string;
  newAddressCity: string;
  customerPhone: string;
  firstName: string;
  lastName: string;
  customerEmail: string;
  isNewAddressMode: boolean;
  addresses: SavedCheckoutAddress[];
  selectedAddressId: number;
}
