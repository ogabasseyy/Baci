import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShipmentGiglAddressSearch } from './ShipmentGiglAddressSearch';

vi.mock('./CheckoutRecoveryAddressInput', () => ({
  CheckoutRecoveryAddressInput: ({
    onSelect,
  }: {
    onSelect: (place: Record<string, string>) => void;
  }) => (
    <>
      <button
        onClick={() =>
          onSelect({
            address: '1 Allen Ave',
            city: 'Ikeja',
            state: 'Lagos',
            latitude: '6.6',
            longitude: '3.35',
          })
        }
        type="button"
      >
        pick pinned
      </button>
      <button
        onClick={() =>
          onSelect({
            address: '2 Broad St',
            city: 'Lagos Island',
            state: 'Lagos',
            latitude: '',
            longitude: '',
          })
        }
        type="button"
      >
        pick unpinned
      </button>
    </>
  ),
}));

describe('ShipmentGiglAddressSearch', () => {
  it('passes the picked place with its map pin', () => {
    const onPlaceSelect = vi.fn();
    render(
      <ShipmentGiglAddressSearch
        address=""
        disabled={false}
        onPlaceSelect={onPlaceSelect}
        onSearchChange={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'pick pinned' }));
    expect(onPlaceSelect).toHaveBeenCalledWith({
      address: '1 Allen Ave',
      city: 'Ikeja',
      state: 'Lagos',
      latitude: 6.6,
      longitude: 3.35,
    });
  });

  it('drops a missing pin instead of sending NaN', () => {
    const onPlaceSelect = vi.fn();
    render(
      <ShipmentGiglAddressSearch
        address=""
        disabled={false}
        onPlaceSelect={onPlaceSelect}
        onSearchChange={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'pick unpinned' }));
    expect(onPlaceSelect).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: undefined, longitude: undefined })
    );
  });
});
