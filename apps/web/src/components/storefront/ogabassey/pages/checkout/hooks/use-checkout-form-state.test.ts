import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCheckoutFormState } from './use-checkout-form-state';

describe('checkout state across payment navigation', () => {
  beforeEach(() => sessionStorage.clear());

  it('does not opt a new or legacy checkout into marketing', () => {
    sessionStorage.setItem(
      'checkout-form',
      JSON.stringify({ firstName: 'QA' })
    );
    const { result } = renderHook(() => useCheckoutFormState());
    expect(result.current.values.newsletterOptIn).toBe(false);
    expect(result.current.values.deliveryCoordinates).toBeNull();
    expect(result.current.values.firstName).toBe('QA');
  });

  it('restores coordinates, delivery choice and unchecked consent after navigation', () => {
    const form = renderHook(() => useCheckoutFormState());
    act(() =>
      form.result.current.setValues({
        newAddressStreet: '2 Olaide Tomori Street',
        newAddressCity: 'Ikeja',
        newAddressState: 'Lagos',
        deliveryCoordinates: { latitude: 6.6, longitude: 3.3 },
        deliveryMethod: 'pickup_station',
        newsletterOptIn: false,
      })
    );
    act(() => window.dispatchEvent(new Event('pagehide')));
    form.unmount();
    const restored = renderHook(() => useCheckoutFormState());
    expect(restored.result.current.values).toMatchObject({
      newAddressStreet: '2 Olaide Tomori Street',
      deliveryCoordinates: { latitude: 6.6, longitude: 3.3 },
      deliveryMethod: 'pickup_station',
      newsletterOptIn: false,
    });
  });

  describe('bugfix: airport subtype dropped on refresh', () => {
    it('restores airport pickup subtype with the airport delivery method', () => {
      const form = renderHook(() => useCheckoutFormState());
      act(() =>
        form.result.current.setValues({
          deliveryMethod: 'airport',
          airportType: 'pickup',
        })
      );
      act(() => window.dispatchEvent(new Event('pagehide')));
      form.unmount();
      const restored = renderHook(() => useCheckoutFormState());
      expect(restored.result.current.values).toMatchObject({
        deliveryMethod: 'airport',
        airportType: 'pickup',
      });
    });
  });
});
