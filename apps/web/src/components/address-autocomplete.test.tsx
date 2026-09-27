import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AddressAutocomplete } from './address-autocomplete';

vi.mock('@/lib/google-places', () => ({
  generateSessionToken: () => 'test-session-token',
  getPlaceDetails: vi.fn(),
  getPlacePredictions: vi.fn(async () => []),
}));

describe('AddressAutocomplete', () => {
  it.each([
    undefined,
    'street-address',
  ])('honors an explicit autocomplete value (%s)', (autoComplete) => {
    render(
      <AddressAutocomplete
        aria-label="Address"
        autoComplete={autoComplete}
        value=""
        onChange={() => undefined}
      />
    );
    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveAttribute(
      'autocomplete',
      autoComplete ?? 'new-password'
    );
  });

  it('forwards id to the rendered address input', () => {
    render(
      <>
        <label htmlFor="checkout-street-address">Delivery Address</label>
        <AddressAutocomplete
          id="checkout-street-address"
          value=""
          onChange={() => undefined}
          placeholder="Start typing your address..."
        />
      </>
    );

    expect(screen.getByLabelText('Delivery Address')).toHaveAttribute(
      'id',
      'checkout-street-address'
    );
  });
});
