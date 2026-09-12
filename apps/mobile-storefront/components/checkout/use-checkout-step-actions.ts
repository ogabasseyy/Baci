import type { Dispatch, SetStateAction } from 'react';
import type {
  FieldErrors,
  UseFormHandleSubmit,
  UseFormSetValue,
} from 'react-hook-form';
import { Alert, Keyboard } from 'react-native';
import type { CheckoutStep } from '@/components/checkout/CheckoutStepper';
import { humanizeCheckoutFieldName } from '@/components/checkout/checkout-form-field.helpers';
import {
  getPickupStationAddressLines,
  isProviderStationPickupQuote,
} from '@/components/checkout/checkout-station-pickup';
import type { MerchantPickupLocation } from '@/components/checkout/merchant-pickup-location';
import type { ShippingAddressInput } from '@/lib/validation';
import { trackCheckoutStep } from '@/services/analytics';
import { trackCheckoutRoutePaymentInfo } from '@/services/tiktok-checkout-route-tracking';
import {
  type UseCheckoutSubmitParams,
  useCheckoutSubmit,
} from './use-checkout-submit';

interface UseCheckoutStepActionsParams extends UseCheckoutSubmitParams {
  handleSubmit: UseFormHandleSubmit<ShippingAddressInput>;
  isPrizeSimulation?: boolean;
  merchantPickupLocation?: MerchantPickupLocation;
  onPrizeSimulationComplete?: () => void;
  resetPaymentSelection: () => void;
  setIsContactCollapsed: Dispatch<SetStateAction<boolean>>;
  setIsDeliveryCollapsed: Dispatch<SetStateAction<boolean>>;
  setValue: UseFormSetValue<ShippingAddressInput>;
  step: CheckoutStep;
}

export function useCheckoutStepActions({
  handleSubmit,
  isPrizeSimulation = false,
  merchantPickupLocation,
  onPrizeSimulationComplete,
  resetPaymentSelection,
  selectedPayment,
  setIsContactCollapsed,
  setIsDeliveryCollapsed,
  setStep,
  setValue,
  step,
  ...submitParams
}: UseCheckoutStepActionsParams) {
  const onCheckoutSubmit = useCheckoutSubmit({
    ...submitParams,
    selectedPayment,
    setStep,
  });
  const onAddressSubmit = (data: ShippingAddressInput) => {
    if (!isPrizeSimulation) {
      trackCheckoutStep('shipping_info', {
        state: data.state,
        city: data.city,
      });
    }
    resetPaymentSelection();
    setStep(isPrizeSimulation ? 'review' : 'payment');
  };
  const handleAddressValidationError = (
    errors: FieldErrors<ShippingAddressInput>
  ) => {
    const hasContactErrors = Boolean(
      errors.firstName || errors.lastName || errors.phone || errors.email
    );
    const hasDeliveryErrors = Boolean(
      errors.address || errors.city || errors.state
    );

    if (hasContactErrors) setIsContactCollapsed(false);
    if (hasDeliveryErrors) setIsDeliveryCollapsed(false);

    const failingFields = (
      Object.keys(errors) as Array<keyof ShippingAddressInput>
    ).filter((field) => Boolean(errors[field]));
    const firstField = failingFields[0];
    const message =
      firstField && errors[firstField]?.message
        ? errors[firstField]?.message
        : firstField
          ? `Please complete your ${humanizeCheckoutFieldName(firstField)} before continuing.`
          : hasDeliveryErrors
            ? 'Please complete your delivery address before continuing.'
            : 'Please complete your contact details before continuing.';

    Alert.alert('Incomplete Details', message, [{ text: 'OK' }]);
  };

  const handleContinue = () => {
    Keyboard.dismiss();

    if (step === 'address') {
      if (submitParams.deliveryMethod === 'pickup_station') {
        if (isProviderStationPickupQuote(submitParams.selectedQuote)) {
          // Paid provider (GIGL) station pickup: the order is collected at the
          // provider station, so satisfy the required address with the station's
          // own address. Leave city/state as the customer's — the quote context
          // depends on them, and the delivery-address card is hidden for pickup,
          // so this is the only place the required address gets populated.
          const stationAddress = getPickupStationAddressLines(
            submitParams.selectedQuote
          ).join(', ');
          if (stationAddress) {
            setValue('address', stationAddress, { shouldValidate: true });
          }
        } else if (submitParams.requiresShippingQuote) {
          Alert.alert(
            'Shipping Required',
            'Please select an available GIGL pickup station before continuing.'
          );
          return;
        } else {
          if (!merchantPickupLocation) {
            Alert.alert(
              'Pickup Unavailable',
              'The merchant office address is not available right now. Choose a GIG Logistics centre or try again.'
            );
            return;
          }
          setValue('address', merchantPickupLocation.address, {
            shouldValidate: true,
          });
          setValue('city', merchantPickupLocation.city, {
            shouldValidate: true,
          });
          setValue('state', merchantPickupLocation.state, {
            shouldValidate: true,
          });
        }
      }
      handleSubmit(onAddressSubmit, handleAddressValidationError)();
      return;
    }

    if (step === 'payment') {
      if (!selectedPayment) {
        Alert.alert(
          'Select Payment Method',
          'Choose how you want to pay before continuing to review.'
        );
        return;
      }
      trackCheckoutStep('payment_method', {
        payment_method: selectedPayment,
      });
      void trackCheckoutRoutePaymentInfo(selectedPayment);
      setStep('review');
    }
  };

  const handlePlaceOrder = isPrizeSimulation
    ? () => {
        if (submitParams.isOrderInFlight.current || !onPrizeSimulationComplete)
          return;
        submitParams.isOrderInFlight.current = true;
        onPrizeSimulationComplete();
      }
    : handleSubmit(onCheckoutSubmit, () => {
        Alert.alert(
          'Incomplete Details',
          'Please fill in all required fields (Address, City, Phone) to place your order.',
          [{ text: 'OK' }]
        );
      });

  return {
    handleAddressValidationError,
    handleContinue,
    handlePlaceOrder,
    onAddressSubmit,
  };
}
