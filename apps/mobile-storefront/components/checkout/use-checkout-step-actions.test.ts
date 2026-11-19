import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { ShippingQuote } from '@/components/checkout/types';
import type { ShippingAddressInput } from '@/lib/validation';
import { useCheckoutStepActions } from './use-checkout-step-actions';

const mockCheckoutSubmit = jest.fn();
const mockTrackCheckoutStep = jest.fn();
const mockTrackCheckoutRoutePaymentInfo = jest.fn();

// useCheckoutSubmit pulls in the full order-submission stack; the address-step
// continue logic under test never calls it, so a no-op keeps the test focused.
jest.mock('./use-checkout-submit', () => ({
  useCheckoutSubmit: () => mockCheckoutSubmit,
}));
jest.mock('@/services/analytics', () => ({
  trackCheckoutPaymentMethodSelected: jest.fn(),
  trackCheckoutStep: (...args: unknown[]) => mockTrackCheckoutStep(...args),
}));
jest.mock('@/services/tiktok-checkout-route-tracking', () => ({
  trackCheckoutRoutePaymentInfo: (...args: unknown[]) =>
    mockTrackCheckoutRoutePaymentInfo(...args),
}));

type Params = Parameters<typeof useCheckoutStepActions>[0];

beforeEach(() => {
  mockCheckoutSubmit.mockClear();
  mockTrackCheckoutStep.mockClear();
  mockTrackCheckoutRoutePaymentInfo.mockClear();
});

function renderStepActions(overrides: Partial<Params>) {
  const resetPaymentSelection = jest.fn();
  const setValue = jest.fn();
  const submitHandler = jest.fn();
  // handleSubmit returns the actual submit handler; the address branch invokes
  // it but the returned handler is a no-op here (validation isn't under test).
  const handleSubmit = jest.fn(() => submitHandler);
  const params = {
    handleSubmit,
    isOrderInFlight: { current: false },
    merchantPickupLocation: {
      address: '2 Olaide Tomori St, Ikeja, Lagos',
      city: 'Ikeja',
      label: 'OgaBassey Office',
      state: 'Lagos',
    },
    setValue,
    setStep: jest.fn(),
    setIsContactCollapsed: jest.fn(),
    setIsDeliveryCollapsed: jest.fn(),
    resetPaymentSelection,
    selectedPayment: 'paystack',
    step: 'address',
    deliveryMethod: 'pickup_station',
    requiresShippingQuote: false,
    selectedQuote: undefined,
    ...overrides,
  } as unknown as Params;

  const { result } = renderHook(() => useCheckoutStepActions(params));
  return { resetPaymentSelection, result, setValue, submitHandler };
}

describe('useCheckoutStepActions — address continue', () => {
  it('clears payment selection before entering the payment step', () => {
    const { resetPaymentSelection, result } = renderStepActions({});

    result.current.onAddressSubmit({
      city: 'Port Harcourt',
      state: 'Rivers',
    } as ShippingAddressInput);

    expect(resetPaymentSelection).toHaveBeenCalledTimes(1);
  });

  it('keeps the quoted receiver address when continuing with provider station pickup', () => {
    // Station display metadata must never replace the receiver used for the
    // quote. The API and fulfillment both validate that original destination.
    const { result, setValue } = renderStepActions({
      selectedQuote: {
        id: 'gigl',
        isStationPickup: true,
        stationName: 'PORT HARCOURT',
        stationAddress: 'GIGL Aba Road, Port Harcourt',
        receiverAddress: '12 Customer Street',
      } as ShippingQuote,
    });

    result.current.handleContinue();

    expect(setValue).toHaveBeenCalledWith('address', '12 Customer Street', {
      shouldValidate: true,
    });
    expect(setValue).not.toHaveBeenCalledWith(
      'city',
      'Ikeja',
      expect.anything()
    );
    expect(setValue).not.toHaveBeenCalledWith(
      'state',
      'Lagos',
      expect.anything()
    );
  });

  it('uses the fetched merchant office when there is no provider quote', () => {
    const { result, setValue } = renderStepActions({
      selectedQuote: undefined,
    });

    result.current.handleContinue();

    expect(setValue).toHaveBeenCalledWith(
      'address',
      '2 Olaide Tomori St, Ikeja, Lagos',
      { shouldValidate: true }
    );
    expect(setValue).toHaveBeenCalledWith('city', 'Ikeja', {
      shouldValidate: true,
    });
    expect(setValue).toHaveBeenCalledWith('state', 'Lagos', {
      shouldValidate: true,
    });
  });

  it('blocks merchant pickup when the fetched office location is incomplete', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const { result, setValue, submitHandler } = renderStepActions({
      merchantPickupLocation: undefined,
      selectedQuote: undefined,
    });

    result.current.handleContinue();

    expect(alertSpy).toHaveBeenCalledWith(
      'Pickup Unavailable',
      'The merchant office address is not available right now. Choose a GIG Logistics centre or try again.'
    );
    expect(setValue).not.toHaveBeenCalled();
    expect(submitHandler).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('blocks non-Lagos provider pickup until a station quote is selected', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const { result, setValue, submitHandler } = renderStepActions({
      requiresShippingQuote: true,
      selectedQuote: undefined,
    });

    result.current.handleContinue();

    expect(alertSpy).toHaveBeenCalledWith(
      'Shipping Required',
      'Please select an available GIGL pickup station before continuing.'
    );
    expect(setValue).not.toHaveBeenCalledWith(
      'city',
      'Ikeja',
      expect.anything()
    );
    expect(setValue).not.toHaveBeenCalledWith(
      'state',
      'Lagos',
      expect.anything()
    );
    expect(submitHandler).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

describe('useCheckoutStepActions — payment continue', () => {
  it('asks the customer to choose a payment method when none is selected', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { result } = renderStepActions({
      selectedPayment: null,
      step: 'payment',
    });

    result.current.handleContinue();

    expect(alertSpy).toHaveBeenCalledWith(
      'Select Payment Method',
      'Choose how you want to pay before continuing to review.'
    );
  });
});

describe('useCheckoutStepActions — test prize simulation', () => {
  it('moves from delivery directly to review without checkout analytics', () => {
    const setStep = jest.fn();
    const { result } = renderStepActions({
      isPrizeSimulation: true,
      setStep,
      step: 'address',
    });

    result.current.onAddressSubmit({
      city: 'Lagos',
      state: 'Lagos',
    } as ShippingAddressInput);

    expect(setStep).toHaveBeenCalledWith('review');
    expect(mockTrackCheckoutStep).not.toHaveBeenCalled();
  });

  it('completes locally without invoking the production order submitter', () => {
    const onPrizeSimulationComplete = jest.fn();
    const { result } = renderStepActions({
      isPrizeSimulation: true,
      onPrizeSimulationComplete,
      step: 'review',
    });

    result.current.handlePlaceOrder();
    result.current.handlePlaceOrder();

    expect(onPrizeSimulationComplete).toHaveBeenCalledTimes(1);
    expect(mockCheckoutSubmit).not.toHaveBeenCalled();
    expect(mockTrackCheckoutStep).not.toHaveBeenCalled();
    expect(mockTrackCheckoutRoutePaymentInfo).not.toHaveBeenCalled();
  });
});
