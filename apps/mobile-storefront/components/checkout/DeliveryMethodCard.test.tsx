import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import FontAwesome from '@react-native-vector-icons/fontawesome';
import { fireEvent, render, screen } from '@testing-library/react-native';
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

describe('DeliveryMethodCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('offers door and pickup (not airport) for a Lagos address', () => {
    render(<DeliveryMethodCard {...baseProps} deliveryState="Lagos" />);
    expect(screen.getByText('By Road')).toBeTruthy();
    expect(screen.getByText('Delivery to your doorstep')).toBeTruthy();
    expect(screen.getByText('Pickup Station')).toBeTruthy();
    expect(screen.queryByText('By Air')).toBeNull();
  });

  it('offers door, airport, and GIGL pickup stations for a non-Lagos airport state', () => {
    render(<DeliveryMethodCard {...baseProps} deliveryState="Rivers" />);
    expect(screen.getByText('By Road')).toBeTruthy();
    expect(screen.getByText('By Air')).toBeTruthy();
    expect(screen.getByText('Pickup Station')).toBeTruthy();
    expect(
      screen.getByRole('radio', {
        name: 'Select By Air',
      })
    ).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: 'Select Pickup Station' })
    ).toBeTruthy();
    expect(screen.queryByText('OgaBassey Office')).toBeNull();
  });

  it('uses clear logistics icons for road and air delivery', () => {
    render(<DeliveryMethodCard {...baseProps} deliveryState="Rivers" />);

    const iconNames = screen
      .UNSAFE_getAllByType(FontAwesome)
      .map((icon) => icon.props.name);

    expect(iconNames).toContain('truck');
    expect(iconNames).toContain('plane');
  });

  it('shows a load prompt for selected non-Lagos pickup without a quote', () => {
    render(
      <DeliveryMethodCard
        {...baseProps}
        selectedMethod="pickup_station"
        deliveryState="Rivers"
      />
    );

    expect(screen.getByText('Pickup Station')).toBeTruthy();
    expect(
      screen.getByText(
        'Select to load available GIGL pickup stations for this area.'
      )
    ).toBeTruthy();
  });

  it('offers paid GIGL pickup stations for non-Lagos addresses with station quotes', () => {
    render(
      <DeliveryMethodCard
        {...baseProps}
        selectedMethod="pickup_station"
        deliveryState="Rivers"
        pickupStationQuote={{
          displayName: 'GIG Logistics - Pickup at PORT HARCOURT',
          id: 'station-quote',
          isStationPickup: true,
          price: 9493,
          provider: 'GIGL',
          stationAddress: 'GIGL Aba Road, Port Harcourt',
          stationCode: 'PHC',
          stationName: 'PORT HARCOURT',
        }}
      />
    );

    expect(
      screen.getByRole('radio', { name: 'Select Pickup Station' })
    ).toBeTruthy();
    expect(screen.getByText('Station code: PHC')).toBeTruthy();
    expect(screen.getByText('PORT HARCOURT')).toBeTruthy();
    expect(screen.getByText('GIGL Aba Road, Port Harcourt')).toBeTruthy();
    expect(screen.queryByText('₦9,493')).toBeNull();
    expect(screen.queryByText('Free')).toBeNull();
  });

  it('keeps Lagos pickup as free merchant pickup even when a GIGL station quote exists', () => {
    render(
      <DeliveryMethodCard
        {...baseProps}
        selectedMethod="pickup_station"
        deliveryState="Lagos"
        pickupStationQuote={{
          displayName: 'GIG Logistics - Pickup at Ikeja',
          id: 'station-quote',
          isStationPickup: true,
          price: 5000,
          provider: 'GIGL',
          stationName: 'Ikeja',
        }}
      />
    );

    expect(screen.getByText('Pickup Station')).toBeTruthy();
    expect(screen.getByText('Free pickup')).toBeTruthy();
  });

  it('offers GIGL pickup stations for a non-Lagos state with no airport', () => {
    render(<DeliveryMethodCard {...baseProps} deliveryState="Ekiti" />);
    expect(screen.getByText('By Road')).toBeTruthy();
    expect(screen.queryByText('By Air')).toBeNull();
    expect(screen.getByText('Pickup Station')).toBeTruthy();
  });

  it('calls onSelectMethod with "door" when door option is pressed', () => {
    render(
      <DeliveryMethodCard
        {...baseProps}
        selectedMethod="airport"
        deliveryState="Rivers"
      />
    );
    fireEvent.press(screen.getByRole('radio', { name: /select by road/i }));
    expect(baseProps.onSelectMethod).toHaveBeenCalledWith('door');
  });

  it('calls onSelectMethod with "airport" when airport option is pressed', () => {
    render(<DeliveryMethodCard {...baseProps} deliveryState="Rivers" />);
    fireEvent.press(screen.getByRole('radio', { name: /select by air/i }));
    expect(baseProps.onSelectMethod).toHaveBeenCalledWith('airport');
  });

  it('calls onSelectMethod with "pickup_station" when pickup option is pressed', () => {
    render(<DeliveryMethodCard {...baseProps} deliveryState="Lagos" />);
    fireEvent.press(
      screen.getByRole('radio', { name: /select pickup station/i })
    );
    expect(baseProps.onSelectMethod).toHaveBeenCalledWith('pickup_station');
  });

  it('calls onSelectMethod with "pickup_station" when non-Lagos GIGL pickup is pressed', () => {
    render(<DeliveryMethodCard {...baseProps} deliveryState="Rivers" />);
    fireEvent.press(
      screen.getByRole('radio', { name: /select pickup station/i })
    );
    expect(baseProps.onSelectMethod).toHaveBeenCalledWith('pickup_station');
  });

  it('shows expanded airport info when airport is selected', () => {
    render(
      <DeliveryMethodCard
        {...baseProps}
        selectedMethod="airport"
        deliveryCity="Port Harcourt"
        deliveryState="Rivers"
      />
    );
    expect(screen.getByText('Port Harcourt Airport Delivery')).toBeTruthy();
    expect(screen.getByText('₦35,000')).toBeTruthy();
    expect(screen.getByText('By Air\nWithin 1–48 hours')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: /Select Port Harcourt Airport Delivery.*By Air.*Within 1–48 hours.*₦35,000/,
      })
    ).toBeTruthy();
  });

  it('shows pickup station address lines when pickup_station is selected', () => {
    render(
      <DeliveryMethodCard
        {...baseProps}
        selectedMethod="pickup_station"
        deliveryState="Lagos"
      />
    );
    expect(screen.getByText('OgaBassey Office')).toBeTruthy();
    expect(screen.getByText('2 Olaide Tomori St, Ikeja, Lagos')).toBeTruthy();
  });

  it('shows selected GIGL pickup station details for non-Lagos pickup', () => {
    render(
      <DeliveryMethodCard
        {...baseProps}
        selectedMethod="pickup_station"
        deliveryState="Rivers"
        pickupStationQuote={{
          displayName: 'GIG Logistics - Pickup at PORT HARCOURT',
          id: 'station-quote',
          isStationPickup: true,
          price: 9493,
          provider: 'GIGL',
          stationAddress: 'GIGL Aba Road, Port Harcourt',
          stationCode: 'PHC',
          stationName: 'PORT HARCOURT',
        }}
      />
    );

    expect(screen.getByText('Pick from a centre close to you')).toBeTruthy();
    expect(screen.getByText('Station code: PHC')).toBeTruthy();
    expect(screen.getByText('PORT HARCOURT')).toBeTruthy();
    expect(screen.getByText('GIGL Aba Road, Port Harcourt')).toBeTruthy();
    expect(screen.queryByText('OgaBassey Office')).toBeNull();
  });

  it('shows free pickup details for merchant pickup station', () => {
    render(
      <DeliveryMethodCard
        {...baseProps}
        selectedMethod="pickup_station"
        deliveryState="Lagos"
      />
    );
    expect(screen.getByText('Free pickup')).toBeTruthy();
  });

  it('does not advertise free office pickup without a merchant location', () => {
    render(
      <DeliveryMethodCard
        {...baseProps}
        merchantPickupLocation={undefined}
        selectedMethod="pickup_station"
        deliveryState="Lagos"
      />
    );

    expect(screen.queryByText('Free pickup')).toBeNull();
    expect(screen.queryByText('Pickup Station')).toBeNull();
  });
});
