import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShipmentFlowGiglPanel } from './ShipmentFlowGiglPanel';

vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: { text: '#111', border: '#ddd' } }),
}));
vi.mock('react-native-google-places-autocomplete', () => ({
  GooglePlacesAutocomplete: ({
    onPress,
    textInputProps,
    query,
  }: {
    textInputProps: {
      accessibilityLabel: string;
      editable: boolean;
      onChangeText: (text: string) => void;
    };
    query: Record<string, string>;
    onPress: (data: { description: string }, details: unknown) => void;
  }) => (
    <>
      <input
        aria-label={textInputProps.accessibilityLabel}
        disabled={!textInputProps.editable}
        onChange={(event) => textInputProps.onChangeText(event.target.value)}
      />
      <span role="status">{query.components}</span>
      <button
        type="button"
        onClick={() =>
          onPress(
            { description: '12 Allen Ave, Ikeja' },
            {
              address_components: [
                {
                  long_name: 'Ikeja',
                  short_name: 'Ikeja',
                  types: ['locality'],
                },
                {
                  long_name: 'Lagos',
                  short_name: 'LA',
                  types: ['administrative_area_level_1'],
                },
                { long_name: 'Nigeria', short_name: 'NG', types: ['country'] },
              ],
              geometry: { location: { lat: 6.6, lng: 3.35 } },
            }
          )
        }
      >
        Pick place
      </button>
    </>
  ),
}));

const props = {
  addressDraft: {},
  bookingAllowed: true,
  error: null,
  fundingAccount: null,
  missingFields: ['address', 'city', 'state'] as (
    | 'address'
    | 'city'
    | 'state'
  )[],
  onAddressFieldChange: vi.fn(),
  onFundWallet: vi.fn(),
  onModeChange: vi.fn(),
  onPlaceSelect: vi.fn(),
  onRefreshFundingAccount: vi.fn(),
  onRetryQuote: vi.fn(),
  onTransferred: vi.fn(),
  quote: null,
  selected: false,
  state: 'ready' as const,
  wallet: null,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('ShipmentFlowGiglPanel places autocomplete', () => {
  it('sends address, city, state and pin from the selected place', () => {
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY', 'key');
    render(<ShipmentFlowGiglPanel {...props} />);
    expect(screen.getByRole('status').textContent).toBe('country:NG');
    fireEvent.click(screen.getByText('Pick place'));
    expect(props.onPlaceSelect).toHaveBeenCalledWith({
      address: '12 Allen Ave, Ikeja',
      city: 'Ikeja',
      state: 'Lagos',
      latitude: 6.6,
      longitude: 3.35,
    });
  });

  it('keeps typed search text in the address draft', () => {
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY', 'key');
    render(<ShipmentFlowGiglPanel {...props} />);
    fireEvent.change(screen.getByLabelText('Search shipping address'), {
      target: { value: '12 Allen' },
    });
    expect(props.onAddressFieldChange).toHaveBeenCalledWith(
      'address',
      '12 Allen'
    );
  });

  it('disables the search while a quote is loading', () => {
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY', 'key');
    render(<ShipmentFlowGiglPanel {...props} state="loading" />);
    expect(
      (screen.getByLabelText('Search shipping address') as HTMLInputElement)
        .disabled
    ).toBe(true);
  });

  it('keeps manual entry usable when no Maps key is configured', () => {
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY', '');
    render(<ShipmentFlowGiglPanel {...props} />);
    expect(screen.queryByLabelText('Search shipping address')).toBeNull();
    fireEvent.change(screen.getByLabelText('Shipping city'), {
      target: { value: 'Abuja' },
    });
    expect(props.onAddressFieldChange).toHaveBeenCalledWith('city', 'Abuja');
  });

  it('hides the search when the address is not missing', () => {
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY', 'key');
    render(<ShipmentFlowGiglPanel {...props} missingFields={['city']} />);
    expect(screen.queryByText('Pick place')).toBeNull();
  });
});
