import '@testing-library/jest-dom/vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { NewCustomerAddressInput } from './NewCustomerAddressInput';
import type { NewCustomerDraft } from './new-order.types';

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,
  default: () => null,
  __esModule: true,
}));

vi.mock('@gorhom/bottom-sheet', async () => {
  const React = await import('react');
  return {
    BottomSheetTextInput: ({
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
  };
});

vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    Keyboard: { dismiss: vi.fn() },
    Pressable: ({
      accessibilityLabel,
      children,
      onPress,
    }: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        {
          'aria-label': accessibilityLabel,
          onClick: () => onPress?.(),
          type: 'button',
        },
        children
      ),
    StyleSheet: { create: (styles: Record<string, unknown>) => styles },
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

type DetailsPayload = {
  status: 'OK';
  result: {
    address_components: Array<{ long_name: string; types: string[] }>;
  };
};

function setupGoogleFetch() {
  const detailResolvers: Array<(payload: DetailsPayload) => void> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('/details/')) {
        return new Promise((resolve) => {
          detailResolvers.push((payload) =>
            resolve({ ok: true, json: async () => payload })
          );
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          predictions: [
            { description: 'Same address', place_id: 'place-1' },
            { description: 'Same address', place_id: 'place-2' },
          ],
        }),
      });
    })
  );
  return detailResolvers;
}

function payload(city: string): DetailsPayload {
  return {
    status: 'OK',
    result: {
      address_components: [{ long_name: city, types: ['locality'] }],
    },
  };
}

function applyUpdates(
  setNewCustomer: ReturnType<typeof vi.fn>
): NewCustomerDraft[] {
  const original = {
    address: 'Original',
    city: '',
    companyName: '',
    country: '',
    countryCode: '',
    customerType: 'individual',
    email: '',
    firstName: '',
    lastName: '',
    phone: '',
    postalCode: '',
    state: '',
  } satisfies NewCustomerDraft;
  return setNewCustomer.mock.calls.map(([update]) =>
    typeof update === 'function' ? update(original) : update
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('NewCustomerAddressInput selection sequencing', () => {
  it('does not apply stale details when same-description selections resolve out of order', async () => {
    const detailResolvers = setupGoogleFetch();
    const setNewCustomer = vi.fn();
    render(
      <NewCustomerAddressInput
        address="same"
        colors={LIGHT_COLORS}
        googleMapsApiKey="key"
        selectedCountryCode="NG"
        setNewCustomer={setNewCustomer}
      />
    );

    const input = screen.getByPlaceholderText('Search Address');
    fireEvent.focus(input);
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button')[0]);
    await waitFor(() => expect(detailResolvers).toHaveLength(1));

    fireEvent.focus(input);
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button')[1]);
    await waitFor(() => expect(detailResolvers).toHaveLength(2));

    await act(async () => detailResolvers[1](payload('Latest')));
    await act(async () => detailResolvers[0](payload('Stale')));

    const updates = applyUpdates(setNewCustomer);
    expect(updates.some((customer) => customer.city === 'Latest')).toBe(true);
    expect(updates.some((customer) => customer.city === 'Stale')).toBe(false);
  });

  it('invalidates pending Google details when the merchant edits the address', async () => {
    const detailResolvers = setupGoogleFetch();
    const setNewCustomer = vi.fn();
    render(
      <NewCustomerAddressInput
        address="same"
        colors={LIGHT_COLORS}
        googleMapsApiKey="key"
        selectedCountryCode="NG"
        setNewCustomer={setNewCustomer}
      />
    );

    const input = screen.getByPlaceholderText('Search Address');
    fireEvent.focus(input);
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button')[0]);
    await waitFor(() => expect(detailResolvers).toHaveLength(1));
    fireEvent.change(input, { target: { value: 'Manually changed' } });

    await act(async () => detailResolvers[0](payload('Stale')));

    expect(
      applyUpdates(setNewCustomer).some((customer) => customer.city === 'Stale')
    ).toBe(false);
  });

  it('bugfix: invalidates pending details when the address input unmounts', async () => {
    const detailResolvers = setupGoogleFetch();
    const setNewCustomer = vi.fn();
    const view = render(
      <NewCustomerAddressInput
        address="same"
        colors={LIGHT_COLORS}
        googleMapsApiKey="key"
        selectedCountryCode="NG"
        setNewCustomer={setNewCustomer}
      />
    );

    const input = screen.getByPlaceholderText('Search Address');
    fireEvent.focus(input);
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button')[0]);
    await waitFor(() => expect(detailResolvers).toHaveLength(1));

    view.unmount();
    setNewCustomer.mockClear();

    await act(async () => detailResolvers[0](payload('Stale')));

    expect(setNewCustomer).not.toHaveBeenCalled();
  });
});
