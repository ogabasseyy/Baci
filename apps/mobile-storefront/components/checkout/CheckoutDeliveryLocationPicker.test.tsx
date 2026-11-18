import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useForm } from 'react-hook-form';
import type { ShippingAddressInput } from '@/lib/validation';
import { CheckoutDeliveryLocationPicker } from './CheckoutDeliveryLocationPicker';

const mockColors = {
  background: '#ffffff',
  border: '#d1d5db',
  card: '#ffffff',
  text: '#111827',
  textSecondary: '#6b7280',
};

const defaultFormValues: ShippingAddressInput = {
  address: '',
  city: '',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  notes: '',
  phone: '+2348012345678',
  state: '',
};

function LocationPickerHarness({
  city = '',
  error,
  isLoading = false,
  isDark = false,
  onPress = jest.fn(),
}: {
  city?: string;
  error?: string;
  isDark?: boolean;
  isLoading?: boolean;
  onPress?: () => void;
}) {
  const form = useForm<ShippingAddressInput>({
    defaultValues: { ...defaultFormValues, city },
  });

  return (
    <CheckoutDeliveryLocationPicker
      colors={mockColors}
      control={form.control}
      error={error}
      isDark={isDark}
      isLoading={isLoading}
      label="City"
      onPress={onPress}
      placeholder="Select city"
      valueName="city"
    />
  );
}

describe('CheckoutDeliveryLocationPicker', () => {
  it('opens the picker when the select control is pressed', () => {
    const onPress = jest.fn();

    render(<LocationPickerHarness onPress={onPress} />);

    fireEvent.press(screen.getByRole('button', { name: 'Select city' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders loading state while location options are loading', () => {
    render(<LocationPickerHarness isLoading />);

    expect(
      screen.getByRole('button', { name: 'Select city, loading' })
    ).toBeTruthy();
    expect(screen.getByLabelText('Loading cities')).toBeTruthy();
  });

  it('words an empty-picker error as a choice, in the error colour', () => {
    render(
      <LocationPickerHarness error="City name must be at least 2 characters" />
    );

    const message = screen.getByText('Choose a city');
    expect(message).toHaveStyle({ color: '#EF4444' });
    expect(
      screen.queryByText('City name must be at least 2 characters')
    ).toBeNull();
  });

  it('uses the lighter dark-theme error red in dark mode', () => {
    render(
      <LocationPickerHarness
        error="City name must be at least 2 characters"
        isDark
      />
    );

    expect(screen.getByText('Choose a city')).toHaveStyle({
      color: '#F87171',
    });
  });

  it('keeps the schema message once a city is chosen', () => {
    render(
      <LocationPickerHarness
        city="X"
        error="City name must be at least 2 characters"
      />
    );

    expect(
      screen.getByText('City name must be at least 2 characters')
    ).toBeTruthy();
  });

  it('renders the selected value instead of the placeholder', () => {
    render(<LocationPickerHarness city="Ikeja" />);

    expect(screen.getByText('Ikeja')).toBeTruthy();
    expect(screen.queryByText('Select city')).toBeNull();
  });
});
