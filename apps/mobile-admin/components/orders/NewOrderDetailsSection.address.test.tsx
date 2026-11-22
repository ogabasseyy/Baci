import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { useNewOrderController } from '@/hooks/useNewOrderController';
import { NewOrderDetailsSection } from './NewOrderDetailsSection';

type GooglePlacesProps = {
  onPress?: (
    data: { description: string },
    details?: {
      address_components?: Array<{
        long_name: string;
        types: string[];
      }>;
    } | null
  ) => void;
};

const googlePlacesState = vi.hoisted(() => ({
  lastProps: null as GooglePlacesProps | null,
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,

  default: () => null,
  __esModule: true,
}));

vi.mock('@react-native-community/datetimepicker', () => ({
  default: () => null,
}));

vi.mock('react-native-google-places-autocomplete', async () => {
  const { Text } = await import('react-native');
  return {
    GooglePlacesAutocomplete: (props: GooglePlacesProps) => {
      googlePlacesState.lastProps = props;
      return <Text>google-places</Text>;
    },
  };
});

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    StatusBar: () => null,
    Platform: { OS: 'web' },
    Pressable: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('button', { type: 'button' }, children),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Switch: () => React.createElement('input', { type: 'checkbox' }),
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    TextInput: ({
      onChangeText,
      placeholder,
      value,
    }: {
      onChangeText?: (value: string) => void;
      placeholder?: string;
      value?: string;
    }) =>
      React.createElement('input', {
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.target.value),
        placeholder,
        value: value ?? '',
      }),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

type DetailsController = Pick<
  ReturnType<typeof useNewOrderController>,
  | 'colors'
  | 'branches'
  | 'customer'
  | 'date'
  | 'deliveryInfo'
  | 'sameAsCustomer'
  | 'selectedBranchId'
  | 'setDate'
  | 'setDeliveryInfo'
  | 'setSelectedBranchId'
  | 'setSameAsCustomer'
  | 'setShowCustomerModal'
  | 'setShowDatePicker'
  | 'showDatePicker'
>;

function makeController(
  overrides: Partial<DetailsController> = {}
): ReturnType<typeof useNewOrderController> {
  return {
    colors: {
      background: '#f8fafc',
      backgroundLight: '#eef2ff',
      border: '#e2e8f0',
      card: '#ffffff',
      primary: '#2563eb',
      success: '#16a34a',
      text: '#0f172a',
      textMuted: '#94a3b8',
      textOnPrimary: '#ffffff',
      textSecondary: '#64748b',
      ...overrides.colors,
    },
    branches: [],
    customer: {
      address: '',
      email: '',
      id: null,
      name: '',
      phone: '',
      ...overrides.customer,
    },
    date: new Date('2024-01-02T00:00:00.000Z'),
    deliveryInfo: {
      address: '',
      city: '',
      name: '',
      phone: '',
      state: '',
      ...overrides.deliveryInfo,
    },
    sameAsCustomer: false,
    selectedBranchId: null,
    setDate: vi.fn(),
    setDeliveryInfo: vi.fn(),
    setSelectedBranchId: vi.fn(),
    setSameAsCustomer: vi.fn(),
    setShowCustomerModal: vi.fn(),
    setShowDatePicker: vi.fn(),
    showDatePicker: false,
    ...overrides,
  } as unknown as ReturnType<typeof useNewOrderController>;
}

describe('NewOrderDetailsSection address behavior', () => {
  const originalGoogleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'maps-test-key';
    googlePlacesState.lastProps = null;
  });

  afterEach(() => {
    if (originalGoogleMapsApiKey === undefined) {
      delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
    } else {
      process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = originalGoogleMapsApiKey;
    }
  });

  it('offers a delivery address for a manual order to the selected customer', () => {
    const controller = makeController({ sameAsCustomer: true });
    controller.customer = { ...controller.customer, id: 'existing-customer' };
    render(
      <NewOrderDetailsSection allowOrderAddressEdit controller={controller} />
    );
    expect(screen.getByText('Delivery Address')).toBeInTheDocument();
    expect(screen.getByText('google-places')).toBeInTheDocument();
  });

  it('resets Places on customer reselection but keeps the input mounted while typing', () => {
    const controller = makeController({ sameAsCustomer: true });
    const customer = {
      ...controller.customer,
      id: 'existing',
      address: 'Saved street',
    };
    const { rerender } = render(
      <NewOrderDetailsSection
        allowOrderAddressEdit
        controller={{ ...controller, customer, customerSelectionRevision: 1 }}
      />
    );
    const originalInput = screen.getByText('google-places');
    rerender(
      <NewOrderDetailsSection
        allowOrderAddressEdit
        controller={{
          ...controller,
          customer: { ...customer, address: 'Typed street' },
          customerSelectionRevision: 1,
        }}
      />
    );
    expect(screen.getByText('google-places')).toBe(originalInput);
    rerender(
      <NewOrderDetailsSection
        allowOrderAddressEdit
        controller={{
          ...controller,
          customer: { ...customer, address: 'Reselected street' },
          customerSelectionRevision: 2,
        }}
      />
    );
    expect(screen.getByText('google-places')).not.toBe(originalInput);
  });

  it('clears stale city and state when the selected address omits those components', () => {
    const setDeliveryInfo = vi.fn();
    const controller = makeController({
      deliveryInfo: {
        address: '',
        city: 'Ikeja',
        name: '',
        phone: '',
        state: 'Lagos',
      },
      setDeliveryInfo: setDeliveryInfo as DetailsController['setDeliveryInfo'],
    });

    render(<NewOrderDetailsSection controller={controller} />);

    googlePlacesState.lastProps?.onPress?.(
      { description: '12 Allen Avenue, Lagos' },
      { address_components: [] }
    );

    const update = setDeliveryInfo.mock.calls.at(-1)?.[0];

    expect(
      update?.({
        address: '',
        city: 'Ikeja',
        name: '',
        phone: '',
        state: 'Lagos',
      })
    ).toEqual({
      address: '12 Allen Avenue, Lagos',
      city: '',
      country: '',
      countryCode: '',
      latitude: undefined,
      longitude: undefined,
      name: '',
      phone: '',
      postalCode: '',
      state: '',
    });
  });
});
