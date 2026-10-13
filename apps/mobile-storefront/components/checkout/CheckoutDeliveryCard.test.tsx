import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { type FieldErrors, useForm } from 'react-hook-form';
import { TextInput as MockTextInput } from 'react-native';
import type { SavedAddress } from '@/lib/checkout-saved-address';
import type { ShippingAddressInput } from '@/lib/validation';
import { CheckoutDeliveryCard } from './CheckoutDeliveryCard';

jest.mock('@/components/ui/AddressAutocomplete', () => ({
  AddressAutocomplete: (props: {
    onChangeText: (value: string) => void;
    placeholder?: string;
    value?: string;
  }) => {
    return (
      <MockTextInput
        onChangeText={props.onChangeText}
        placeholder={props.placeholder ?? 'Start typing your address…'}
        value={props.value}
      />
    );
  },
}));

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

const homeAddress: SavedAddress = {
  address: '12 Marina Road',
  city: 'Lagos',
  country: 'Nigeria',
  full_name: 'Ada Lovelace',
  id: 'home',
  is_default: true,
  label: 'Home',
  phone: '+2348012345678',
  state: 'Lagos',
};

function CheckoutDeliveryCardHarness({
  currentDeliverySummary = '',
  errors = {},
  hasSavedAddresses = false,
  isAddingNewAddress = true,
  isCollapsed = false,
  isAuthenticated = true,
  isLoadingCities = false,
  isLoadingLocations = false,
  isLoadingSavedAddresses = false,
  showLocationPickers = true,
  onAddressTextChanged = jest.fn(
    (text: string, updateAddress: (value: string) => void) =>
      updateAddress(text)
  ),
  onOpenCityPicker = jest.fn(),
  onOpenStatePicker = jest.fn(),
  onToggleCollapsed = jest.fn(),
  onToggleSaveAsDefaultAddress = jest.fn(),
  savedAddresses = [],
  selectedSavedAddress = null,
  selectedSavedAddressId = null,
}: {
  currentDeliverySummary?: string;
  errors?: FieldErrors<ShippingAddressInput>;
  hasSavedAddresses?: boolean;
  isAddingNewAddress?: boolean;
  isAuthenticated?: boolean;
  isCollapsed?: boolean;
  isLoadingCities?: boolean;
  isLoadingLocations?: boolean;
  isLoadingSavedAddresses?: boolean;
  showLocationPickers?: boolean;
  onAddressTextChanged?: (
    text: string,
    updateAddress: (value: string) => void
  ) => void;
  onOpenCityPicker?: () => void;
  onOpenStatePicker?: () => void;
  onToggleCollapsed?: () => void;
  onToggleSaveAsDefaultAddress?: () => void;
  savedAddresses?: SavedAddress[];
  selectedSavedAddress?: SavedAddress | null;
  selectedSavedAddressId?: string | null;
}) {
  const form = useForm<ShippingAddressInput>({
    defaultValues: defaultFormValues,
  });

  return (
    <CheckoutDeliveryCard
      colors={mockColors}
      control={form.control}
      currentDeliverySummary={currentDeliverySummary}
      defaultSavedAddress={homeAddress}
      errors={errors}
      hasSavedAddresses={hasSavedAddresses}
      isAddingNewAddress={isAddingNewAddress}
      isAuthenticated={isAuthenticated}
      isCollapsed={isCollapsed}
      isDark={false}
      isLoadingCities={isLoadingCities}
      isLoadingLocations={isLoadingLocations}
      isLoadingSavedAddresses={isLoadingSavedAddresses}
      showLocationPickers={showLocationPickers}
      onAddressSelected={jest.fn()}
      onAddressTextChanged={onAddressTextChanged}
      onOpenCityPicker={onOpenCityPicker}
      onOpenNewAddressEditor={jest.fn()}
      onOpenStatePicker={onOpenStatePicker}
      onToggleCollapsed={onToggleCollapsed}
      onToggleSaveAsDefaultAddress={onToggleSaveAsDefaultAddress}
      onUseSavedAddress={jest.fn()}
      saveAsDefaultAddress={false}
      savedAddresses={savedAddresses}
      selectedSavedAddress={selectedSavedAddress}
      selectedSavedAddressId={selectedSavedAddressId}
    />
  );
}

describe('CheckoutDeliveryCard', () => {
  it('renders the expanded new-address form and city/state picker actions', () => {
    const onAddressTextChanged = jest.fn(
      (text: string, updateAddress: (value: string) => void) =>
        updateAddress(text)
    );
    const onOpenCityPicker = jest.fn();
    const onOpenStatePicker = jest.fn();
    const onToggleSaveAsDefaultAddress = jest.fn();

    render(
      <CheckoutDeliveryCardHarness
        onAddressTextChanged={onAddressTextChanged}
        onOpenCityPicker={onOpenCityPicker}
        onOpenStatePicker={onOpenStatePicker}
        onToggleSaveAsDefaultAddress={onToggleSaveAsDefaultAddress}
      />
    );

    expect(screen.getByText('Delivery')).toBeTruthy();
    fireEvent.changeText(
      screen.getByPlaceholderText('Start typing your address…'),
      '12 Marina Road'
    );
    fireEvent.press(screen.getByRole('button', { name: 'Select city' }));
    fireEvent.press(screen.getByRole('button', { name: 'Select state' }));
    fireEvent.press(
      screen.getByRole('checkbox', { name: 'Set as default address' })
    );

    expect(onAddressTextChanged).toHaveBeenCalledWith(
      '12 Marina Road',
      expect.any(Function)
    );
    expect(onOpenCityPicker).toHaveBeenCalledTimes(1);
    expect(onOpenStatePicker).toHaveBeenCalledTimes(1);
    expect(onToggleSaveAsDefaultAddress).toHaveBeenCalledTimes(1);
  });

  it('renders the collapsed delivery summary and edit action', () => {
    const onToggleCollapsed = jest.fn();

    render(
      <CheckoutDeliveryCardHarness
        currentDeliverySummary="12 Marina Road, Lagos, Lagos"
        hasSavedAddresses
        isAddingNewAddress={false}
        isCollapsed
        onToggleCollapsed={onToggleCollapsed}
        savedAddresses={[homeAddress]}
        selectedSavedAddress={homeAddress}
        selectedSavedAddressId="home"
      />
    );

    expect(screen.getByText('Default address')).toBeTruthy();
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByText('12 Marina Road, Lagos, Lagos')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Edit Delivery' }));

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('shows saved address controls when a customer uses a saved destination', () => {
    const onToggleSaveAsDefaultAddress = jest.fn();

    render(
      <CheckoutDeliveryCardHarness
        hasSavedAddresses
        isAddingNewAddress={false}
        onToggleSaveAsDefaultAddress={onToggleSaveAsDefaultAddress}
        savedAddresses={[homeAddress]}
        selectedSavedAddress={homeAddress}
        selectedSavedAddressId="home"
      />
    );

    expect(screen.getByText('Delivery options')).toBeTruthy();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();

    fireEvent.press(
      screen.getByRole('checkbox', { name: 'Keep as default address' })
    );

    expect(onToggleSaveAsDefaultAddress).toHaveBeenCalledTimes(1);
  });

  it('shows loading indicators for saved addresses and location pickers', () => {
    render(
      <CheckoutDeliveryCardHarness
        hasSavedAddresses
        isAddingNewAddress
        isLoadingCities
        isLoadingLocations
        isLoadingSavedAddresses
        savedAddresses={[homeAddress]}
      />
    );

    expect(screen.getByLabelText('Loading saved addresses')).toBeTruthy();
    expect(screen.getByLabelText('Loading cities')).toBeTruthy();
    expect(screen.getByLabelText('Loading states')).toBeTruthy();
  });

  it('displays validation errors for city and state selectors', () => {
    render(
      <CheckoutDeliveryCardHarness
        errors={{
          city: { message: 'City is required', type: 'required' },
          state: { message: 'State is required', type: 'required' },
        }}
      />
    );

    expect(screen.getByText('City is required')).toBeTruthy();
    expect(screen.getByText('State is required')).toBeTruthy();
  });

  it('hides manual city and state selectors for a complete Google location', () => {
    render(<CheckoutDeliveryCardHarness showLocationPickers={false} />);

    expect(screen.queryByRole('button', { name: 'Select city' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select state' })).toBeNull();
  });
});
