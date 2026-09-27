import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { DeliveryMethodCard } from './DeliveryMethodCard';

const mockColors = {
  card: '#ffffff',
  text: '#111827',
  textSecondary: '#6b7280',
  border: '#e5e7eb',
  background: '#f9fafb',
} as Parameters<typeof DeliveryMethodCard>[0]['colors'];

const baseProps = {
  colors: mockColors,
  isDark: false,
  selectedMethod: 'door' as const,
  onSelectMethod: jest.fn(),
  doorSubtitle: 'Delivered to your address',
  airportFee: 35000,
  merchantPickupLocation: {
    address: '2 Olaide Tomori St, Ikeja, Lagos',
    city: 'Ikeja',
    label: 'OgaBassey Office',
    state: 'Lagos',
  },
};

describe('DeliveryMethodCard airport eligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hides By Air for a Lagos-origin address in an airport-eligible state', () => {
    // Regression: a stale saved address with city Lagos and state Oyo
    // resolves as store-origin delivery, so state-level airport
    // eligibility (or a GoFaster quote) must not expose By Air.
    const { unmount } = render(
      <DeliveryMethodCard
        {...baseProps}
        deliveryCity="Lagos"
        deliveryState="Oyo"
      />
    );
    expect(screen.queryByText('By Air')).toBeNull();
    unmount();

    render(
      <DeliveryMethodCard
        {...baseProps}
        deliveryCity="Lagos"
        deliveryState="Oyo"
        hasGiglGoFasterQuote
      />
    );
    expect(screen.queryByText('By Air')).toBeNull();
  });

  it('still offers By Air via a GIGL GoFaster quote outside Lagos', () => {
    render(
      <DeliveryMethodCard
        {...baseProps}
        deliveryCity="Abeokuta"
        deliveryState="Ogun"
        hasGiglGoFasterQuote
      />
    );

    expect(screen.getByText('By Air')).toBeTruthy();
  });
});
