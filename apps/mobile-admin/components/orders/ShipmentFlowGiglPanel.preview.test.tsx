import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShipmentFlowGiglPanel } from './ShipmentFlowGiglPanel';
import { giglPanelBase as base } from './ShipmentFlowGiglPanel.test-support';

vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      backgroundLight: '#eee',
      border: '#ddd',
      card: '#fff',
      primary: '#06f',
      primaryLight: '#def',
      text: '#111',
      textMuted: '#777',
      textSecondary: '#555',
      warning: '#CA8A04',
    },
  }),
}));

describe('ShipmentFlowGiglPanel for staff who can only preview GIG', () => {
  it('shows staff who cannot book the GIG price and a note instead of a dead option', () => {
    const { rerender } = render(
      <ShipmentFlowGiglPanel
        {...base}
        bookingAllowed={false}
        selected
        fundingAccount={{
          accountName: 'BACI / Store',
          accountNumber: '1234567890',
          bankName: 'Wema Bank',
          currency: 'NGN',
          status: 'active',
        }}
      />
    );

    expect(screen.getByText('GIG delivery')).toBeTruthy();
    expect(screen.getByText('₦11,000')).toBeTruthy();
    expect(screen.getByText('Wallet balance: ₦1,000')).toBeTruthy();
    expect(screen.getByText('Top up ₦10,000 to book')).toBeTruthy();
    expect(
      screen.getByText(
        'Ask the store owner or an admin to book GIG for this order.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Ship with GIG/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fund wallet' })).toBeNull();
    expect(screen.queryByText('1234567890')).toBeNull();

    rerender(
      <ShipmentFlowGiglPanel
        {...base}
        bookingAllowed={false}
        state="funding_pending"
      />
    );
    expect(
      screen.queryByRole('button', { name: 'Check funding status' })
    ).toBeNull();
  });

  it('does not show the booking note to users who can book GIG', () => {
    render(<ShipmentFlowGiglPanel {...base} />);
    expect(
      screen.queryByText(
        'Ask the store owner or an admin to book GIG for this order.'
      )
    ).toBeNull();
  });
});
