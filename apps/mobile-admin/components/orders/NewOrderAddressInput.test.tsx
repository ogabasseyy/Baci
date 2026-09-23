import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { NewOrderAddressInput } from './NewOrderAddressInput';

const googlePlacesState: {
  lastProps?: Record<string, unknown>;
} = {};

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    StatusBar: () => null,
    Alert: { alert: vi.fn() },
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    TextInput: ({
      onChangeText,
      placeholder,
      testID,
      value,
    }: {
      onChangeText?: (t: string) => void;
      placeholder?: string;
      testID?: string;
      value?: string;
    }) =>
      React.createElement('input', {
        'data-testid': testID,
        onChange: (e: { target: { value: string } }) =>
          onChangeText?.(e.target.value),
        placeholder,
        value: value ?? '',
      }),
    View: ({
      children,
      testID,
    }: {
      children?: React.ReactNode;
      testID?: string;
    }) => React.createElement('div', { 'data-testid': testID }, children),
  };
});

vi.mock('react-native-google-places-autocomplete', async () => {
  const React = await import('react');
  return {
    GooglePlacesAutocomplete: (props: Record<string, unknown>) => {
      googlePlacesState.lastProps = props;
      return React.createElement(
        'div',
        { 'data-testid': 'google-places-autocomplete' },
        String(props.placeholder ?? '')
      );
    },
  };
});

vi.mock('./new-order.styles', () => ({ styles: {} }));

type AddressInputController = React.ComponentProps<
  typeof NewOrderAddressInput
>['controller'];

function makeController(
  overrides: Partial<AddressInputController> = {}
): AddressInputController {
  return {
    colors: LIGHT_COLORS,
    deliveryInfo: {
      address: '',
      city: '',
      name: '',
      phone: '',
      state: '',
    },
    setDeliveryInfo: vi.fn(),
    ...overrides,
  };
}

describe('NewOrderAddressInput', () => {
  it('renders a plain TextInput when googleMapsApiKey is undefined', () => {
    render(
      <NewOrderAddressInput
        controller={makeController()}
        googleMapsApiKey={undefined}
      />
    );

    expect(
      screen.getByPlaceholderText('Enter delivery address')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('google-places-autocomplete')).toBeNull();
  });

  it('renders a plain TextInput when googleMapsApiKey is an empty string', () => {
    render(
      <NewOrderAddressInput controller={makeController()} googleMapsApiKey="" />
    );

    expect(
      screen.getByPlaceholderText('Enter delivery address')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('google-places-autocomplete')).toBeNull();
  });

  it('renders GooglePlacesAutocomplete when a key is provided', () => {
    render(
      <NewOrderAddressInput
        controller={makeController()}
        googleMapsApiKey="AIza-test-key"
      />
    );

    expect(
      screen.getByTestId('google-places-autocomplete')
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter delivery address')).toBeNull();
  });

  it('calls setDeliveryInfo when the fallback TextInput changes', () => {
    const setDeliveryInfo = vi.fn();
    render(
      <NewOrderAddressInput
        controller={makeController({ setDeliveryInfo })}
        googleMapsApiKey={undefined}
      />
    );

    const input = screen.getByPlaceholderText('Enter delivery address');
    fireEvent.change(input, { target: { value: '12 Lagos Street' } });

    expect(setDeliveryInfo).toHaveBeenCalled();
  });

  it('preserves city and state when the fallback address changes', () => {
    const setDeliveryInfo = vi.fn();
    render(
      <NewOrderAddressInput
        controller={makeController({
          deliveryInfo: {
            address: 'Old address',
            city: 'Lagos',
            name: '',
            phone: '',
            state: 'Lagos State',
          },
          setDeliveryInfo,
        })}
        googleMapsApiKey={undefined}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Enter delivery address'), {
      target: { value: '12 Marina' },
    });

    const updater = setDeliveryInfo.mock.calls[0][0] as (
      previous: AddressInputController['deliveryInfo']
    ) => AddressInputController['deliveryInfo'];

    expect(
      updater({
        address: 'Old address',
        city: 'Lagos',
        name: '',
        phone: '',
        state: 'Lagos State',
      })
    ).toEqual({
      address: '12 Marina',
      city: 'Lagos',
      name: '',
      phone: '',
      state: 'Lagos State',
      latitude: undefined,
      longitude: undefined,
    });
  });

  it('updates city and state through dedicated fallback inputs', () => {
    const setDeliveryInfo = vi.fn();
    render(
      <NewOrderAddressInput
        controller={makeController({ setDeliveryInfo })}
        googleMapsApiKey={undefined}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('City'), {
      target: { value: 'Abuja' },
    });
    fireEvent.change(screen.getByPlaceholderText('State'), {
      target: { value: 'FCT' },
    });

    const cityUpdater = setDeliveryInfo.mock.calls[0][0] as (
      previous: AddressInputController['deliveryInfo']
    ) => AddressInputController['deliveryInfo'];
    const stateUpdater = setDeliveryInfo.mock.calls[1][0] as (
      previous: AddressInputController['deliveryInfo']
    ) => AddressInputController['deliveryInfo'];

    expect(
      cityUpdater({
        address: '',
        city: '',
        name: '',
        phone: '',
        state: '',
      })
    ).toEqual({
      address: '',
      city: 'Abuja',
      name: '',
      phone: '',
      state: '',
    });
    expect(
      stateUpdater({
        address: '',
        city: 'Abuja',
        name: '',
        phone: '',
        state: '',
      })
    ).toEqual({
      address: '',
      city: 'Abuja',
      name: '',
      phone: '',
      state: 'FCT',
    });
  });

  it('bugfix: enters recovery when Places details omit locality', () => {
    const setDeliveryInfo = vi.fn();

    render(
      <NewOrderAddressInput
        controller={makeController({
          deliveryInfo: {
            address: 'Old address',
            city: 'Old city',
            name: '',
            phone: '',
            state: 'Old state',
          },
          setDeliveryInfo,
        })}
        googleMapsApiKey="AIza-test-key"
      />
    );

    const onPress = googlePlacesState.lastProps?.onPress as
      | ((
          data: { description: string },
          details?: {
            address_components?: Array<{
              long_name: string;
              types: string[];
            }>;
          } | null
        ) => void)
      | undefined;

    act(() => {
      onPress?.(
        { description: '42 Marina, Lagos' },
        { address_components: [] }
      );
    });

    expect(
      screen.getByText(
        'Could not load full address details. Enter city and state to continue.'
      )
    ).toBeTruthy();
    expect(screen.getByPlaceholderText('City')).toBeTruthy();
    expect(screen.getByPlaceholderText('State')).toBeTruthy();

    const updater = setDeliveryInfo.mock.calls[0][0] as (
      previous: AddressInputController['deliveryInfo']
    ) => AddressInputController['deliveryInfo'];

    expect(
      updater({
        address: 'Old address',
        city: 'Old city',
        name: '',
        phone: '',
        state: 'Old state',
      })
    ).toEqual({
      address: '42 Marina, Lagos',
      city: '',
      name: '',
      phone: '',
      state: '',
      country: '',
      countryCode: '',
      postalCode: '',
      latitude: undefined,
      longitude: undefined,
    });
  });

  it('preserves city and state when onChangeText fires after place selection', async () => {
    const setDeliveryInfo = vi.fn();

    render(
      <NewOrderAddressInput
        controller={makeController({
          deliveryInfo: {
            address: 'Old address',
            city: 'Ikeja',
            name: '',
            phone: '',
            state: 'Lagos',
          },
          setDeliveryInfo,
        })}
        googleMapsApiKey="AIza-test-key"
      />
    );

    const onPress = googlePlacesState.lastProps?.onPress as
      | ((
          data: { description: string },
          details?: {
            address_components?: Array<{
              long_name: string;
              short_name?: string;
              types: string[];
            }>;
            geometry?: { location?: { lat: number; lng: number } };
          } | null
        ) => void)
      | undefined;
    const textInputProps = googlePlacesState.lastProps?.textInputProps as
      | { onChangeText?: (text: string) => void }
      | undefined;

    onPress?.(
      { description: '42 Marina, Ikeja, Lagos' },
      {
        address_components: [
          { long_name: 'Ikeja', types: ['locality'] },
          { long_name: 'Lagos', types: ['administrative_area_level_1'] },
          {
            long_name: 'Nigeria',
            short_name: 'NG',
            types: ['country'],
          },
        ],
        geometry: { location: { lat: 6.6, lng: 3.3 } },
      }
    );
    await Promise.resolve();
    textInputProps?.onChangeText?.('42 Marina, Ikeja, Lagos');

    expect(setDeliveryInfo).toHaveBeenCalledTimes(2);
    const selectionUpdater = setDeliveryInfo.mock.calls[0][0] as (
      previous: AddressInputController['deliveryInfo']
    ) => AddressInputController['deliveryInfo'];
    const followUpUpdater = setDeliveryInfo.mock.calls[1][0] as (
      previous: AddressInputController['deliveryInfo']
    ) => AddressInputController['deliveryInfo'];

    const afterSelection = selectionUpdater({
      address: 'Old address',
      city: 'Ikeja',
      name: '',
      phone: '',
      state: 'Lagos',
    });
    expect(afterSelection).toMatchObject({
      address: '42 Marina, Ikeja, Lagos',
      city: 'Ikeja',
      state: 'Lagos',
      country: 'Nigeria',
      countryCode: 'NG',
      latitude: 6.6,
      longitude: 3.3,
    });
    expect(
      followUpUpdater({
        ...afterSelection,
        city: 'Ikeja',
        state: 'Lagos',
      })
    ).toEqual({
      ...afterSelection,
      address: '42 Marina, Ikeja, Lagos',
      city: 'Ikeja',
      state: 'Lagos',
    });
  });

  it('clears stale geocoding on the first keystroke that differs from the selection', async () => {
    const setDeliveryInfo = vi.fn();

    render(
      <NewOrderAddressInput
        controller={makeController({
          deliveryInfo: {
            address: 'Old address',
            city: 'Ikeja',
            name: '',
            phone: '',
            state: 'Lagos',
          },
          setDeliveryInfo,
        })}
        googleMapsApiKey="AIza-test-key"
      />
    );

    const onPress = googlePlacesState.lastProps?.onPress as
      | ((
          data: { description: string },
          details?: {
            address_components?: Array<{
              long_name: string;
              types: string[];
            }>;
            geometry?: { location?: { lat: number; lng: number } };
          } | null
        ) => void)
      | undefined;
    const textInputProps = googlePlacesState.lastProps?.textInputProps as
      | { onChangeText?: (text: string) => void }
      | undefined;

    onPress?.(
      { description: '42 Marina, Ikeja, Lagos' },
      {
        address_components: [
          { long_name: 'Ikeja', types: ['locality'] },
          { long_name: 'Lagos', types: ['administrative_area_level_1'] },
        ],
        geometry: { location: { lat: 6.6, lng: 3.3 } },
      }
    );
    await Promise.resolve();
    textInputProps?.onChangeText?.('42 Marina, Ikeja, Lago');

    expect(setDeliveryInfo).toHaveBeenCalledTimes(2);
    const editUpdater = setDeliveryInfo.mock.calls[1][0] as (
      previous: AddressInputController['deliveryInfo']
    ) => AddressInputController['deliveryInfo'];
    expect(
      editUpdater({
        address: '42 Marina, Ikeja, Lagos',
        city: 'Ikeja',
        name: '',
        phone: '',
        state: 'Lagos',
        country: 'Nigeria',
        countryCode: 'NG',
        postalCode: '',
        latitude: 6.6,
        longitude: 3.3,
      })
    ).toEqual({
      address: '42 Marina, Ikeja, Lago',
      city: '',
      name: '',
      phone: '',
      state: '',
      country: '',
      countryCode: '',
      postalCode: '',
      latitude: undefined,
      longitude: undefined,
    });
  });

  it('configures the Google Places dropdown elevation for Android stacking', () => {
    render(
      <NewOrderAddressInput
        controller={makeController()}
        googleMapsApiKey="AIza-test-key"
      />
    );

    const styles = googlePlacesState.lastProps?.styles as
      | {
          listView?: {
            elevation?: number;
          };
        }
      | undefined;

    expect(styles?.listView?.elevation).toBe(5);
  });

  it('bugfix: shows manual city/state when Places details are unavailable', () => {
    const setDeliveryInfo = vi.fn();

    const { rerender } = render(
      <NewOrderAddressInput
        controller={makeController({
          deliveryInfo: {
            address: 'Old address',
            city: 'Old city',
            name: '',
            phone: '',
            state: 'Old state',
          },
          setDeliveryInfo,
        })}
        googleMapsApiKey="AIza-test-key"
      />
    );

    expect(screen.queryByPlaceholderText('City')).toBeNull();
    expect(screen.queryByPlaceholderText('State')).toBeNull();

    const onPress = googlePlacesState.lastProps?.onPress as
      | ((data: { description: string }, details?: unknown) => void)
      | undefined;

    onPress?.({ description: '42 Marina, Lagos' }, null);

    const updater = setDeliveryInfo.mock.calls[0][0] as (
      previous: AddressInputController['deliveryInfo']
    ) => AddressInputController['deliveryInfo'];
    expect(
      updater({
        address: 'Old address',
        city: 'Old city',
        name: '',
        phone: '',
        state: 'Old state',
      })
    ).toEqual({
      address: '42 Marina, Lagos',
      city: '',
      name: '',
      phone: '',
      state: '',
      country: '',
      countryCode: '',
      postalCode: '',
      latitude: undefined,
      longitude: undefined,
    });

    rerender(
      <NewOrderAddressInput
        controller={makeController({
          deliveryInfo: {
            address: '42 Marina, Lagos',
            city: '',
            name: '',
            phone: '',
            state: '',
          },
          setDeliveryInfo,
        })}
        googleMapsApiKey="AIza-test-key"
      />
    );

    // State is internal; re-fire onPress so recovery UI mounts on this render.
    (
      googlePlacesState.lastProps?.onPress as (
        data: { description: string },
        details?: unknown
      ) => void
    )?.({ description: '42 Marina, Lagos' }, null);

    expect(
      screen.getByText(
        'Could not load full address details. Enter city and state to continue.'
      )
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('City')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('State')).toBeInTheDocument();
  });
});
