import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }));
vi.mock('react-native-google-places-autocomplete', () => ({
  GooglePlacesAutocomplete: ({
    onPress,
    textInputProps,
  }: {
    textInputProps: { editable: boolean; onChangeText: (text: string) => void };
    onPress: (data: { description: string }, details: unknown) => void;
  }) => (
    <>
      <input
        aria-label="Search destination"
        disabled={!textInputProps.editable}
        onChange={(event) => textInputProps.onChangeText(event.target.value)}
      />
      <button
        type="button"
        onClick={() =>
          onPress(
            { description: 'Selected' },
            { geometry: { location: { lat: 6, lng: 3 } } }
          )
        }
      >
        Select pin
      </button>
    </>
  ),
}));

import { CheckoutRecoveryAddressInput } from './CheckoutRecoveryAddressInput';

describe('CheckoutRecoveryAddressInput', () => {
  it('returns complete newly selected geometry', () => {
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY', 'test');
    const select = vi.fn();
    render(
      <CheckoutRecoveryAddressInput
        onSelect={select}
        onSearchChange={vi.fn()}
        address=""
      />
    );
    fireEvent.click(screen.getByText('Select pin'));
    expect(select).toHaveBeenCalledWith({
      address: 'Selected',
      city: '',
      state: '',
      latitude: '6',
      longitude: '3',
    });
    vi.unstubAllEnvs();
  });
  it('allows manual entry when address search is unavailable', () => {
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY', '');
    render(
      <CheckoutRecoveryAddressInput
        onSelect={vi.fn()}
        onSearchChange={vi.fn()}
        address=""
      />
    );
    expect(screen.queryByText('Select pin')).toBeNull();
    vi.unstubAllEnvs();
  });
  it('invalidates search edits, preserves a selected description and disables input while busy', () => {
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY', 'test');
    const change = vi.fn();
    const select = vi.fn();
    const { rerender } = render(
      <CheckoutRecoveryAddressInput
        onSelect={select}
        onSearchChange={change}
        address=""
      />
    );
    fireEvent.change(screen.getByLabelText('Search destination'), {
      target: { value: 'Different street' },
    });
    expect(change).toHaveBeenCalledWith('Different street');
    fireEvent.click(screen.getByText('Select pin'));
    change.mockClear();
    rerender(
      <CheckoutRecoveryAddressInput
        onSelect={select}
        onSearchChange={change}
        address="Selected"
      />
    );
    fireEvent.change(screen.getByLabelText('Search destination'), {
      target: { value: 'Selected' },
    });
    expect(change).not.toHaveBeenCalled();
    rerender(
      <CheckoutRecoveryAddressInput
        onSelect={select}
        onSearchChange={change}
        address="Selected"
        disabled
      />
    );
    expect(
      (screen.getByLabelText('Search destination') as HTMLInputElement).disabled
    ).toBe(true);
    select.mockClear();
    fireEvent.click(screen.getByText('Select pin'));
    expect(select).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
