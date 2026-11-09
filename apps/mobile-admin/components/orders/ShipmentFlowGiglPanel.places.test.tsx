import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShipmentFlowGiglPanel } from './ShipmentFlowGiglPanel';

vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: { text: '#111', border: '#ddd' } }),
}));
vi.mock('./CheckoutRecoveryAddressInput', () => ({
  CheckoutRecoveryAddressInput: ({
    onSelect,
  }: {
    onSelect: (p: Record<string, string>) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onSelect({
          address: '12 Allen Ave, Ikeja',
          city: 'Ikeja',
          state: 'Lagos',
        })
      }
    >
      Pick place
    </button>
  ),
}));

const props = {
  addressDraft: {},
  error: null,
  fundingAccount: null,
  missingFields: ['address', 'city', 'state'] as (
    | 'address'
    | 'city'
    | 'state'
  )[],
  onAddressFieldChange: vi.fn(),
  onFundWallet: vi.fn(),
  onRefreshFundingAccount: vi.fn(),
  onModeChange: vi.fn(),
  onRetryQuote: vi.fn(),
  onTransferred: vi.fn(),
  quote: null,
  selected: false,
  state: 'ready' as const,
  wallet: null,
};

describe('ShipmentFlowGiglPanel places autocomplete', () => {
  it('fills address, city and state from the selected place', () => {
    const onAddressFieldChange = vi.fn();
    render(
      <ShipmentFlowGiglPanel
        {...props}
        onAddressFieldChange={onAddressFieldChange}
      />
    );
    fireEvent.click(screen.getByText('Pick place'));
    expect(onAddressFieldChange).toHaveBeenCalledWith(
      'address',
      '12 Allen Ave, Ikeja'
    );
    expect(onAddressFieldChange).toHaveBeenCalledWith('city', 'Ikeja');
    expect(onAddressFieldChange).toHaveBeenCalledWith('state', 'Lagos');
  });

  it('keeps manual entry possible', () => {
    const onAddressFieldChange = vi.fn();
    render(
      <ShipmentFlowGiglPanel
        {...props}
        onAddressFieldChange={onAddressFieldChange}
      />
    );
    fireEvent.change(screen.getByLabelText('Shipping city'), {
      target: { value: 'Abuja' },
    });
    expect(onAddressFieldChange).toHaveBeenCalledWith('city', 'Abuja');
  });

  it('hides the search when the address is not missing', () => {
    render(<ShipmentFlowGiglPanel {...props} missingFields={['city']} />);
    expect(screen.queryByText('Pick place')).toBeNull();
  });
});
