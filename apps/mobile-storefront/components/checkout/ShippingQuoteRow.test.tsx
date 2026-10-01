import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ShippingQuoteRow } from './ShippingQuoteRow';

const colors = {
  border: '#1F2937',
  card: '#111827',
  text: '#F9FAFB',
  textSecondary: '#9CA3AF',
} as Parameters<typeof ShippingQuoteRow>[0]['colors'];

describe('ShippingQuoteRow', () => {
  it('renders airport delivery with the same selectable quote treatment', () => {
    const onSelect = jest.fn();
    render(
      <ShippingQuoteRow
        colors={colors}
        isSelected
        leadingIcon="airplane-outline"
        onSelect={onSelect}
        quote={{
          carrierName: 'By Air',
          deliveryRange: '24-48 working hours',
          displayName: 'Port Harcourt Airport Delivery',
          id: 'airport-delivery',
          price: 35_000,
        }}
        selectedAccentColor="#EF2B2D"
        selectedBackgroundColor={colors.card}
        estimateOverride="Within 1–48 hours"
      />
    );

    expect(screen.getByText('Port Harcourt Airport Delivery')).toBeTruthy();
    expect(screen.getByText('By Air\nWithin 1–48 hours')).toBeTruthy();
    expect(screen.getByText('₦35,000')).toBeTruthy();
    const quoteButton = screen.getByRole('button', {
      name: /Select Port Harcourt Airport Delivery.*By Air.*Within 1–48 hours.*₦35,000/,
    });
    expect(quoteButton).toHaveAccessibilityState({ selected: true });

    fireEvent.press(quoteButton);
    expect(onSelect).toHaveBeenCalledWith('airport-delivery');
  });

  it('does not show an estimate for pickup routes', () => {
    render(
      <ShippingQuoteRow
        colors={colors}
        estimateOverride={null}
        isSelected={false}
        onSelect={jest.fn()}
        quote={{
          carrierName: 'GIG Logistics',
          deliveryRange: '3 days',
          displayName: 'Pickup at PHC D-Line',
          id: 'station-quote',
          isStationPickup: true,
          price: 7_692,
          provider: 'GIGL',
          stationCode: 'PHC-DL',
        }}
        selectedAccentColor="#EF2B2D"
        selectedBackgroundColor={colors.card}
      />
    );

    expect(screen.queryByText(/Est\./)).toBeNull();
    expect(screen.queryByText(/3 days/)).toBeNull();
  });

  it('shows GIG branding and station context for a pickup quote', () => {
    render(
      <ShippingQuoteRow
        colors={colors}
        isSelected={false}
        onSelect={jest.fn()}
        quote={{
          carrierName: 'GIG Logistics',
          displayName: 'Pickup at PHC D-Line',
          id: 'station-quote',
          price: 7_692,
          provider: 'GIGL',
          stationCode: 'PHC-DL',
        }}
        selectedAccentColor="#EF2B2D"
        selectedBackgroundColor={colors.card}
      />
    );

    expect(
      screen.getByRole('image', { name: 'GIG Logistics logo' })
    ).toBeTruthy();
    expect(screen.getByText(/Station code: PHC-DL/)).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: /Pickup at PHC D-Line.*Station code: PHC-DL.*₦7,692/,
      })
    ).toHaveAccessibilityState({ selected: false });
  });

  it('renders Topship branding without misclassifying similar carrier names', () => {
    const { rerender } = render(
      <ShippingQuoteRow
        colors={colors}
        isSelected={false}
        onSelect={jest.fn()}
        quote={{
          carrierName: 'Topship',
          displayName: 'Topship Standard',
          id: 'topship-quote',
          price: 10_000,
        }}
        selectedAccentColor="#EF2B2D"
        selectedBackgroundColor={colors.card}
      />
    );

    expect(screen.getByText('Topship')).toBeTruthy();

    rerender(
      <ShippingQuoteRow
        colors={colors}
        isSelected={false}
        onSelect={jest.fn()}
        quote={{
          carrierName: 'Gigi Express',
          displayName: 'Gigi Express Standard',
          id: 'other-quote',
          price: 10_000,
        }}
        selectedAccentColor="#EF2B2D"
        selectedBackgroundColor={colors.card}
      />
    );
    expect(
      screen.queryByRole('image', { name: 'GIG Logistics logo' })
    ).toBeNull();
  });
});
