import '@testing-library/jest-dom/vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { NewCustomerAddressInput } from './NewCustomerAddressInput';

const keyboardState = vi.hoisted(() => ({
  dismiss: vi.fn(),
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,
  default: () => null,
  __esModule: true,
}));

vi.mock('@gorhom/bottom-sheet', async () => {
  const React = await import('react');

  return {
    BottomSheetTextInput: ({
      accessibilityLabel,
      onBlur,
      onChangeText,
      onFocus,
      placeholder,
      value,
    }: {
      accessibilityLabel?: string;
      onBlur?: () => void;
      onChangeText?: (value: string) => void;
      onFocus?: () => void;
      placeholder?: string;
      value?: string;
    }) =>
      React.createElement('input', {
        'aria-label': accessibilityLabel,
        'data-gorhom-input': 'true',
        onBlur,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.target.value),
        onFocus,
        placeholder,
        value: value ?? '',
      }),
  };
});

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    StatusBar: () => null,
    Keyboard: { dismiss: keyboardState.dismiss },
    Pressable: ({
      accessibilityLabel,
      accessibilityRole,
      children,
      onPress,
    }: {
      accessibilityLabel?: string;
      accessibilityRole?: string;
      children?: React.ReactNode;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        {
          'aria-label': accessibilityLabel,
          role: accessibilityRole === 'button' ? 'button' : undefined,
          onClick: () => onPress?.(),
          type: 'button',
        },
        children
      ),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    TextInput: ({
      onBlur,
      onChangeText,
      onFocus,
      placeholder,
      value,
    }: {
      onBlur?: () => void;
      onChangeText?: (value: string) => void;
      onFocus?: () => void;
      placeholder?: string;
      value?: string;
    }) =>
      React.createElement('input', {
        onBlur,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.target.value),
        onFocus,
        placeholder,
        value: value ?? '',
      }),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

describe('NewCustomerAddressInput', () => {
  beforeEach(() => {
    keyboardState.dismiss.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches address suggestions without nesting a virtualized autocomplete list', async () => {
    const setNewCustomer = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        predictions: [
          {
            description: '12 Allen Avenue, Ikeja, Lagos',
            place_id: 'place-1',
            structured_formatting: {
              main_text: '12 Allen Avenue',
              secondary_text: 'Ikeja, Lagos',
            },
          },
        ],
      }),
      status: 200,
    });
    vi.stubGlobal('fetch', fetchMock);

    const view = render(
      <NewCustomerAddressInput
        address=""
        colors={LIGHT_COLORS}
        googleMapsApiKey="maps-test-key"
        selectedCountryCode="GH"
        setNewCustomer={setNewCustomer}
      />
    );

    fireEvent.focus(screen.getByPlaceholderText('Search Address'));
    fireEvent.change(screen.getByPlaceholderText('Search Address'), {
      target: { value: '12 Allen Avenue' },
    });

    view.rerender(
      <NewCustomerAddressInput
        address="12 Allen Avenue"
        colors={LIGHT_COLORS}
        googleMapsApiKey="maps-test-key"
        selectedCountryCode="GH"
        setNewCustomer={setNewCustomer}
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'https://maps.googleapis.com/maps/api/place/autocomplete/json?input=12+Allen+Avenue&key=maps-test-key&language=en&components=country%3Agh',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    // Wait for the autocomplete response to paint suggestions — fetch being
    // called is not enough; json() + setState still race on CI.
    await waitFor(() => {
      expect(screen.getByText('12 Allen Avenue')).toBeInTheDocument();
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Use address 12 Allen Avenue, Ikeja, Lagos',
      })
    );

    expect(setNewCustomer).toHaveBeenCalledTimes(2);
    expect(keyboardState.dismiss).toHaveBeenCalledTimes(1);
  });

  it('falls back to a plain text input when Google Maps is unavailable', () => {
    const setNewCustomer = vi.fn();

    render(
      <NewCustomerAddressInput
        address="12 Allen"
        city="Lagos"
        colors={LIGHT_COLORS}
        googleMapsApiKey={undefined}
        selectedCountryCode="NG"
        setNewCustomer={setNewCustomer}
        state="Lagos State"
      />
    );

    const input = screen.getByPlaceholderText('Enter address');
    fireEvent.change(input, { target: { value: '14 Bode Thomas' } });

    expect(screen.queryByLabelText('Search Address')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('City')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('State')).toBeInTheDocument();
    expect(setNewCustomer).toHaveBeenCalledTimes(1);

    const updater = setNewCustomer.mock.calls[0][0] as (
      previous: Record<string, unknown>
    ) => Record<string, unknown>;
    expect(
      updater({
        address: '12 Allen',
        city: 'Lagos',
        state: 'Lagos State',
        latitude: 6.5,
        longitude: 3.3,
      })
    ).toEqual({
      address: '14 Bode Thomas',
      city: 'Lagos',
      state: 'Lagos State',
      latitude: undefined,
      longitude: undefined,
    });
  });

  it('clears locality when typing with a Google Maps key', () => {
    const setNewCustomer = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ predictions: [] }),
      })
    );

    render(
      <NewCustomerAddressInput
        address="12 Allen"
        city="Lagos"
        colors={LIGHT_COLORS}
        googleMapsApiKey="maps-test-key"
        selectedCountryCode="NG"
        setNewCustomer={setNewCustomer}
        state="Lagos State"
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Search Address'), {
      target: { value: '14 Bode Thomas' },
    });

    const updater = setNewCustomer.mock.calls[0][0] as (
      previous: Record<string, unknown>
    ) => Record<string, unknown>;
    expect(
      updater({
        address: '12 Allen',
        city: 'Lagos',
        state: 'Lagos State',
        country: 'Nigeria',
        countryCode: 'NG',
        postalCode: '100001',
        latitude: 6.5,
        longitude: 3.3,
      })
    ).toEqual({
      address: '14 Bode Thomas',
      city: '',
      state: '',
      country: '',
      countryCode: '',
      postalCode: '',
      latitude: undefined,
      longitude: undefined,
    });
  });

  it('keeps suggestions hidden when a pending lookup resolves after blur', async () => {
    vi.useFakeTimers();
    const setNewCustomer = vi.fn();
    let resolveFetch!: (response: {
      json: () => Promise<unknown>;
      ok: boolean;
      status: number;
    }) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const view = render(
        <NewCustomerAddressInput
          address=""
          colors={LIGHT_COLORS}
          googleMapsApiKey="maps-test-key"
          selectedCountryCode="NG"
          setNewCustomer={setNewCustomer}
        />
      );
      const input = screen.getByPlaceholderText('Search Address');

      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '12 Allen' } });
      view.rerender(
        <NewCustomerAddressInput
          address="12 Allen"
          colors={LIGHT_COLORS}
          googleMapsApiKey="maps-test-key"
          selectedCountryCode="NG"
          setNewCustomer={setNewCustomer}
        />
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fireEvent.blur(input);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });

      await act(async () => {
        resolveFetch({
          ok: true,
          json: vi.fn().mockResolvedValue({
            predictions: [
              {
                description: '12 Allen Avenue, Ikeja, Lagos',
                place_id: 'place-1',
                structured_formatting: {
                  main_text: '12 Allen Avenue',
                  secondary_text: 'Ikeja, Lagos',
                },
              },
            ],
          }),
          status: 200,
        });
        await Promise.resolve();
      });

      expect(screen.queryByText('12 Allen Avenue')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts the pending autocomplete request when the address changes again', async () => {
    vi.useFakeTimers();
    const setNewCustomer = vi.fn();
    const fetchMock = vi.fn(
      (_input: string, _init?: RequestInit) => new Promise(() => undefined)
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const view = render(
        <NewCustomerAddressInput
          address=""
          colors={LIGHT_COLORS}
          googleMapsApiKey="maps-test-key"
          selectedCountryCode="NG"
          setNewCustomer={setNewCustomer}
        />
      );
      const input = screen.getByPlaceholderText('Search Address');

      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '12 Allen' } });
      view.rerender(
        <NewCustomerAddressInput
          address="12 Allen"
          colors={LIGHT_COLORS}
          googleMapsApiKey="maps-test-key"
          selectedCountryCode="NG"
          setNewCustomer={setNewCustomer}
        />
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
      expect(firstSignal).toBeInstanceOf(AbortSignal);
      expect(firstSignal.aborted).toBe(false);

      await act(async () => {
        view.rerender(
          <NewCustomerAddressInput
            address="12 Allen Avenue"
            colors={LIGHT_COLORS}
            googleMapsApiKey="maps-test-key"
            selectedCountryCode="NG"
            setNewCustomer={setNewCustomer}
          />
        );
        await Promise.resolve();
      });

      expect(firstSignal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears suggestions when the autocomplete request fails', async () => {
    const setNewCustomer = vi.fn();
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    vi.stubGlobal('__DEV__', true);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          predictions: [
            {
              description: '12 Allen Avenue, Ikeja, Lagos',
              place_id: 'place-1',
              structured_formatting: {
                main_text: '12 Allen Avenue',
                secondary_text: 'Ikeja, Lagos',
              },
            },
          ],
        }),
        status: 200,
      })
      .mockResolvedValueOnce({
        ok: false,
        json: vi.fn(),
        status: 500,
      });
    vi.stubGlobal('fetch', fetchMock);

    const view = render(
      <NewCustomerAddressInput
        address=""
        colors={LIGHT_COLORS}
        googleMapsApiKey="maps-test-key"
        selectedCountryCode="NG"
        setNewCustomer={setNewCustomer}
      />
    );

    fireEvent.focus(screen.getByPlaceholderText('Search Address'));
    fireEvent.change(screen.getByPlaceholderText('Search Address'), {
      target: { value: '12 Allen' },
    });
    view.rerender(
      <NewCustomerAddressInput
        address="12 Allen"
        colors={LIGHT_COLORS}
        googleMapsApiKey="maps-test-key"
        selectedCountryCode="NG"
        setNewCustomer={setNewCustomer}
      />
    );

    await waitFor(() =>
      expect(screen.getByText('12 Allen Avenue')).toBeInTheDocument()
    );

    fireEvent.change(screen.getByPlaceholderText('Search Address'), {
      target: { value: 'Bad address' },
    });
    view.rerender(
      <NewCustomerAddressInput
        address="Bad address"
        colors={LIGHT_COLORS}
        googleMapsApiKey="maps-test-key"
        selectedCountryCode="NG"
        setNewCustomer={setNewCustomer}
      />
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(
        '[NewCustomerAddressInput] Places lookup failed',
        expect.objectContaining({ error: expect.any(Error) })
      )
    );
    await waitFor(() =>
      expect(screen.queryByText('12 Allen Avenue')).not.toBeInTheDocument()
    );
    warnSpy.mockRestore();
  });

  describe('bugfix: Save raced ahead of place details', () => {
    it('reports pending while Google place details are in flight', async () => {
      let resolveDetails: ((value: unknown) => void) | undefined;
      const onAddressDetailsPendingChange = vi.fn();
      const setNewCustomer = vi.fn();
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url.includes('/details/')) {
            return new Promise((resolve) => {
              resolveDetails = resolve;
            });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              predictions: [
                {
                  description: '12 Allen Avenue, Ikeja',
                  place_id: 'place-1',
                },
              ],
            }),
          });
        })
      );

      const view = render(
        <NewCustomerAddressInput
          address=""
          colors={LIGHT_COLORS}
          googleMapsApiKey="maps-test-key"
          onAddressDetailsPendingChange={onAddressDetailsPendingChange}
          selectedCountryCode="NG"
          setNewCustomer={setNewCustomer}
        />
      );

      fireEvent.focus(screen.getByPlaceholderText('Search Address'));
      fireEvent.change(screen.getByPlaceholderText('Search Address'), {
        target: { value: '12 Allen' },
      });
      view.rerender(
        <NewCustomerAddressInput
          address="12 Allen"
          colors={LIGHT_COLORS}
          googleMapsApiKey="maps-test-key"
          onAddressDetailsPendingChange={onAddressDetailsPendingChange}
          selectedCountryCode="NG"
          setNewCustomer={setNewCustomer}
        />
      );

      await waitFor(() =>
        expect(screen.getByText('12 Allen Avenue, Ikeja')).toBeInTheDocument()
      );
      fireEvent.click(screen.getByText('12 Allen Avenue, Ikeja'));

      expect(onAddressDetailsPendingChange).toHaveBeenCalledWith(true);

      await act(async () => {
        resolveDetails?.({
          ok: true,
          json: async () => ({
            status: 'OK',
            result: {
              address_components: [
                { long_name: 'Ikeja', types: ['locality'] },
                { long_name: 'Lagos', types: ['administrative_area_level_1'] },
                { long_name: 'Nigeria', types: ['country'] },
              ],
              geometry: { location: { lat: 6.6, lng: 3.3 } },
            },
          }),
        });
      });

      await waitFor(() =>
        expect(onAddressDetailsPendingChange).toHaveBeenCalledWith(false)
      );
    });

    it('bugfix: enters recovery when Places details omit locality', async () => {
      const onAddressDetailsPendingChange = vi.fn();
      const setNewCustomer = vi.fn();
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url.includes('/details/')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                status: 'OK',
                result: {
                  address_components: [
                    {
                      long_name: 'Nigeria',
                      short_name: 'NG',
                      types: ['country'],
                    },
                  ],
                  geometry: { location: { lat: 6.6, lng: 3.3 } },
                },
              }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              predictions: [
                {
                  description: '42 Marina, Lagos',
                  place_id: 'place-locality-missing',
                },
              ],
            }),
          });
        })
      );

      const view = render(
        <NewCustomerAddressInput
          address=""
          colors={LIGHT_COLORS}
          googleMapsApiKey="maps-test-key"
          onAddressDetailsPendingChange={onAddressDetailsPendingChange}
          selectedCountryCode="NG"
          setNewCustomer={setNewCustomer}
        />
      );

      fireEvent.focus(screen.getByPlaceholderText('Search Address'));
      fireEvent.change(screen.getByPlaceholderText('Search Address'), {
        target: { value: '42 Marina' },
      });
      view.rerender(
        <NewCustomerAddressInput
          address="42 Marina"
          colors={LIGHT_COLORS}
          googleMapsApiKey="maps-test-key"
          onAddressDetailsPendingChange={onAddressDetailsPendingChange}
          selectedCountryCode="NG"
          setNewCustomer={setNewCustomer}
        />
      );

      await waitFor(() =>
        expect(screen.getByText('42 Marina, Lagos')).toBeInTheDocument()
      );
      fireEvent.click(screen.getByText('42 Marina, Lagos'));

      await waitFor(() =>
        expect(
          screen.getByText(
            'Could not load full address details. Enter city and state to continue.'
          )
        ).toBeInTheDocument()
      );
      expect(screen.getByPlaceholderText('City')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('State')).toBeInTheDocument();
      expect(onAddressDetailsPendingChange).toHaveBeenCalledWith(true);
      expect(onAddressDetailsPendingChange.mock.calls.at(-1)?.[0]).toBe(true);
    });

    it('keeps Save blocked and shows manual locality fields when details are missing', async () => {
      const onAddressDetailsPendingChange = vi.fn();
      const setNewCustomer = vi.fn();
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url.includes('/details/')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({ status: 'ZERO_RESULTS', result: null }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              predictions: [
                {
                  description: '12 Allen Avenue, Ikeja',
                  place_id: 'place-1',
                },
              ],
            }),
          });
        })
      );

      const view = render(
        <NewCustomerAddressInput
          address=""
          colors={LIGHT_COLORS}
          googleMapsApiKey="maps-test-key"
          onAddressDetailsPendingChange={onAddressDetailsPendingChange}
          selectedCountryCode="NG"
          setNewCustomer={setNewCustomer}
        />
      );

      fireEvent.focus(screen.getByPlaceholderText('Search Address'));
      fireEvent.change(screen.getByPlaceholderText('Search Address'), {
        target: { value: '12 Allen' },
      });
      view.rerender(
        <NewCustomerAddressInput
          address="12 Allen"
          colors={LIGHT_COLORS}
          googleMapsApiKey="maps-test-key"
          onAddressDetailsPendingChange={onAddressDetailsPendingChange}
          selectedCountryCode="NG"
          setNewCustomer={setNewCustomer}
        />
      );

      await waitFor(() =>
        expect(screen.getByText('12 Allen Avenue, Ikeja')).toBeInTheDocument()
      );
      fireEvent.click(screen.getByText('12 Allen Avenue, Ikeja'));

      await waitFor(() =>
        expect(
          screen.getByText(
            'Could not load full address details. Enter city and state to continue.'
          )
        ).toBeInTheDocument()
      );
      expect(screen.getByPlaceholderText('City')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('State')).toBeInTheDocument();
      expect(onAddressDetailsPendingChange).toHaveBeenCalledWith(true);
      expect(onAddressDetailsPendingChange.mock.calls.at(-1)?.[0]).toBe(true);

      view.rerender(
        <NewCustomerAddressInput
          address="12 Allen Avenue, Ikeja"
          city="Ikeja"
          colors={LIGHT_COLORS}
          googleMapsApiKey="maps-test-key"
          onAddressDetailsPendingChange={onAddressDetailsPendingChange}
          selectedCountryCode="NG"
          setNewCustomer={setNewCustomer}
          state="Lagos"
        />
      );

      await waitFor(() =>
        expect(onAddressDetailsPendingChange).toHaveBeenCalledWith(false)
      );
    });

    it('keeps locality gate after editing the recovery address field', async () => {
      const onAddressDetailsPendingChange = vi.fn();
      const setNewCustomer = vi.fn();
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url.includes('/details/')) {
            return Promise.resolve({
              ok: true,
              json: async () => ({ status: 'ZERO_RESULTS', result: null }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              predictions: [
                {
                  description: '12 Allen Avenue, Ikeja',
                  place_id: 'place-1',
                },
              ],
            }),
          });
        })
      );

      const view = render(
        <NewCustomerAddressInput
          address=""
          colors={LIGHT_COLORS}
          googleMapsApiKey="maps-test-key"
          onAddressDetailsPendingChange={onAddressDetailsPendingChange}
          selectedCountryCode="NG"
          setNewCustomer={setNewCustomer}
        />
      );

      fireEvent.focus(screen.getByPlaceholderText('Search Address'));
      fireEvent.change(screen.getByPlaceholderText('Search Address'), {
        target: { value: '12 Allen' },
      });
      view.rerender(
        <NewCustomerAddressInput
          address="12 Allen"
          colors={LIGHT_COLORS}
          googleMapsApiKey="maps-test-key"
          onAddressDetailsPendingChange={onAddressDetailsPendingChange}
          selectedCountryCode="NG"
          setNewCustomer={setNewCustomer}
        />
      );

      await waitFor(() =>
        expect(screen.getByText('12 Allen Avenue, Ikeja')).toBeInTheDocument()
      );
      fireEvent.click(screen.getByText('12 Allen Avenue, Ikeja'));

      await waitFor(() =>
        expect(screen.getByPlaceholderText('Enter address')).toBeInTheDocument()
      );
      onAddressDetailsPendingChange.mockClear();
      setNewCustomer.mockClear();

      fireEvent.change(screen.getByPlaceholderText('Enter address'), {
        target: { value: '12 Allen Avenue, Suite 2' },
      });

      expect(
        screen.getByText(
          'Could not load full address details. Enter city and state to continue.'
        )
      ).toBeInTheDocument();
      expect(screen.getByPlaceholderText('City')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('State')).toBeInTheDocument();
      expect(onAddressDetailsPendingChange).not.toHaveBeenCalledWith(false);

      const updater = setNewCustomer.mock.calls[0][0] as (
        previous: Record<string, unknown>
      ) => Record<string, unknown>;
      expect(
        updater({
          address: '12 Allen Avenue, Ikeja',
          city: '',
          state: '',
          latitude: 6.5,
          longitude: 3.3,
        })
      ).toEqual({
        address: '12 Allen Avenue, Suite 2',
        city: '',
        state: '',
        latitude: undefined,
        longitude: undefined,
      });
    });
  });
});
