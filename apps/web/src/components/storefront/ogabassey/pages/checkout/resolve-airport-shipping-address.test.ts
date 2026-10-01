import { describe, expect, it } from 'vitest';
import { resolveAirportShippingAddress } from './resolve-airport-shipping-address';

describe('resolveAirportShippingAddress', () => {
  it('uses the saved destination for a provider-backed airport quote', () => {
    expect(
      resolveAirportShippingAddress({
        airportType: 'delivery',
        manualAddress: '',
        manualCity: '',
        manualState: '',
        savedAddress: '1 Airport Road, Port Harcourt, Rivers',
      })
    ).toEqual({
      address: '1 Airport Road, Port Harcourt, Rivers',
      city: 'Port Harcourt',
      state: 'Rivers',
    });
  });

  it('uses the saved destination for fixed local airport delivery', () => {
    expect(
      resolveAirportShippingAddress({
        airportType: 'pickup',
        manualAddress: '',
        manualCity: '',
        manualState: '',
        savedAddress: '1 Airport Road, Port Harcourt, Rivers',
      })
    ).toEqual({
      address: '1 Airport Road, Port Harcourt, Rivers',
      city: 'Port Harcourt',
      state: 'Rivers',
    });
  });

  it('prefers a manually entered airport destination over the saved address', () => {
    // Arrange
    const input = {
      airportType: 'delivery' as const,
      manualAddress: '2 Airport Road, Lagos, Lagos',
      manualCity: 'Lagos',
      manualState: 'Lagos',
      savedAddress: '1 Airport Road, Port Harcourt, Rivers',
    };

    // Act
    const result = resolveAirportShippingAddress(input);

    // Assert
    expect(result).toEqual({
      address: '2 Airport Road, Lagos, Lagos',
      city: 'Lagos',
      state: 'Lagos',
    });
  });

  it('uses airport defaults when no destination is provided', () => {
    // Arrange
    const input = {
      airportType: 'pickup' as const,
      manualAddress: '',
      manualCity: '',
      manualState: '',
    };

    // Act
    const result = resolveAirportShippingAddress(input);

    // Assert
    expect(result).toEqual({
      address: 'Airport Pickup',
      city: 'Airport',
      state: 'Nigeria',
    });
  });
});
