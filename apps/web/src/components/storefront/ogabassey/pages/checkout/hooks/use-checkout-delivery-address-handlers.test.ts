import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCheckoutDeliveryAddressHandlers } from './use-checkout-delivery-address-handlers';

function renderAddressHandlers() {
  const dependencies = {
    clearInferredLocationDebounce: vi.fn(),
    merchantCountry: 'NG',
    resetQuotesForAddressChange: vi.fn(),
    scheduleInferredLocationUpdate: vi.fn(),
    setFields: vi.fn(),
    setIsNewAddressMode: vi.fn(),
    setNewAddressCity: vi.fn(),
    setNewAddressState: vi.fn(),
    setSelectedAddressId: vi.fn(),
    shippingStates: ['Lagos', 'Ogun'],
  };
  const hook = renderHook(() =>
    useCheckoutDeliveryAddressHandlers(dependencies)
  );
  return { ...hook, dependencies };
}

describe('useCheckoutDeliveryAddressHandlers', () => {
  it('selects a saved address, clears pending inference and resets quotes', () => {
    const { result, dependencies } = renderAddressHandlers();

    act(() =>
      result.current.onSelectAddress({
        id: 17,
        label: 'Home',
        address: '12 Allen Avenue, Ikeja, Lagos',
        phone: '+2348000000000',
        isDefault: true,
      })
    );

    expect(dependencies.setSelectedAddressId).toHaveBeenCalledWith(17);
    expect(dependencies.setIsNewAddressMode).toHaveBeenCalledWith(false);
    expect(dependencies.clearInferredLocationDebounce).toHaveBeenCalledOnce();
    expect(dependencies.resetQuotesForAddressChange).toHaveBeenCalledOnce();
    expect(dependencies.setNewAddressCity).toHaveBeenCalledWith('Ikeja');
    expect(dependencies.setNewAddressState).toHaveBeenCalledWith('Lagos');
  });

  it('schedules a valid manual address inference and invalidates prior quotes', () => {
    const { result, dependencies } = renderAddressHandlers();

    act(() => result.current.onStreetChange('12 Allen Avenue, Ikeja, Lagos'));

    expect(dependencies.setFields).toHaveBeenCalledWith({
      newAddressStreet: '12 Allen Avenue, Ikeja, Lagos',
      newAddressCity: '',
      newAddressState: '',
      deliveryCoordinates: null,
    });
    expect(dependencies.scheduleInferredLocationUpdate).toHaveBeenCalledWith({
      city: 'Ikeja',
      state: 'Lagos',
    });
    expect(dependencies.resetQuotesForAddressChange).toHaveBeenCalledOnce();
  });

  it('clears location, pending inference and quotes for a short address', () => {
    const { result, dependencies } = renderAddressHandlers();

    act(() => result.current.onStreetChange('123'));

    expect(dependencies.clearInferredLocationDebounce).toHaveBeenCalledOnce();
    expect(dependencies.setNewAddressCity).toHaveBeenCalledWith('');
    expect(dependencies.setNewAddressState).toHaveBeenCalledWith('');
    expect(dependencies.resetQuotesForAddressChange).toHaveBeenCalledOnce();
    expect(dependencies.scheduleInferredLocationUpdate).not.toHaveBeenCalled();
  });

  it('clears pending inference and quotes when a long address has no location match', () => {
    const { result, dependencies } = renderAddressHandlers();

    act(() => result.current.onStreetChange('No map result here'));

    expect(dependencies.clearInferredLocationDebounce).toHaveBeenCalledOnce();
    expect(dependencies.setFields).toHaveBeenNthCalledWith(2, {
      newAddressCity: '',
      newAddressState: '',
    });
    expect(dependencies.resetQuotesForAddressChange).toHaveBeenCalledOnce();
    expect(dependencies.scheduleInferredLocationUpdate).not.toHaveBeenCalled();
  });

  it('sets selected place coordinates only when both coordinates are finite', () => {
    const { result, dependencies } = renderAddressHandlers();

    act(() =>
      result.current.onSelectPlace({
        formattedAddress: '12 Allen Avenue, Ikeja, Lagos',
        streetNumber: '12',
        route: 'Allen Avenue',
        city: 'Ikeja',
        state: 'Lagos',
        zip: '',
        country: 'Nigeria',
        location: { latitude: 6.6, longitude: Number.NaN },
      })
    );

    expect(dependencies.setFields).toHaveBeenCalledWith({
      newAddressStreet: '12 Allen Avenue, Ikeja, Lagos',
      newAddressState: 'Lagos',
      newAddressCity: 'Ikeja',
      deliveryCoordinates: null,
    });
    expect(dependencies.clearInferredLocationDebounce).toHaveBeenCalledOnce();
    expect(dependencies.resetQuotesForAddressChange).toHaveBeenCalledOnce();
  });
});
