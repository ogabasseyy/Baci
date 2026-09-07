import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShipmentFlowGiglPanel } from './ShipmentFlowGiglPanel';

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
    },
  }),
}));

const actions = {
  onAddressFieldChange: vi.fn(),
  onFundWallet: vi.fn(),
  onRefreshFundingAccount: vi.fn(),
  onModeChange: vi.fn(),
  onRetryQuote: vi.fn(),
  onTransferred: vi.fn(),
};

const base = {
  ...actions,
  addressDraft: {},
  error: null,
  fundingAccount: null,
  missingFields: [],
  quote: {
    id: 'quote-1',
    provider: 'GIGL' as const,
    serviceTier: 'Express',
    carrierName: 'GIG Logistics',
    displayName: 'Door Delivery',
    estimatedDays: 2,
    price: 11000,
    currency: 'NGN' as const,
    pickupIncluded: true,
    insuranceIncluded: false,
    expiresAt: '2026-09-01T18:00:00.000Z',
  },
  selected: false,
  state: 'ready' as const,
  wallet: { availableBalance: 1000, canBook: false, shortfall: 10000 },
};

describe('ShipmentFlowGiglPanel', () => {
  it('shows one bundled GIG price and exact wallet shortfall', () => {
    render(<ShipmentFlowGiglPanel {...base} />);
    expect(screen.getByText('Ship with GIG')).toBeTruthy();
    expect(screen.getByText('₦11,000')).toBeTruthy();
    expect(screen.getByText(/Shortfall: ₦10,000/)).toBeTruthy();
    expect(screen.queryByText(/margin|provider cost/i)).toBeNull();
  });

  it('shows only server-reported accessible address fields', () => {
    render(
      <ShipmentFlowGiglPanel
        {...base}
        addressDraft={{ city: '' }}
        missingFields={['city']}
        quote={null}
        state="missing_address"
      />
    );
    fireEvent.change(screen.getByLabelText('Shipping city'), {
      target: { value: 'Ikeja' },
    });
    expect(actions.onAddressFieldChange).toHaveBeenCalledWith('city', 'Ikeja');
    expect(screen.queryByLabelText('Shipping state')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry quote' }));
    expect(actions.onRetryQuote).toHaveBeenCalled();
  });

  it('shows safe active DVA details and does not auto-book after transfer', () => {
    render(
      <ShipmentFlowGiglPanel
        {...base}
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
    expect(screen.getByText('Wema Bank')).toBeTruthy();
    expect(screen.getByText('1234567890')).toBeTruthy();
    expect(screen.getByText('BACI / Store')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "I've transferred" }));
    expect(actions.onTransferred).toHaveBeenCalledOnce();
  });

  it('keeps provider errors recoverable through Self Fulfill outside the panel', () => {
    render(
      <ShipmentFlowGiglPanel
        {...base}
        error="GIG shipping is temporarily unavailable."
        quote={null}
        state="error"
      />
    );
    expect(screen.getByText(/temporarily unavailable/)).toBeTruthy();
  });

  it('allows explicit GIGL selection to start a quote when none is precomputed', () => {
    render(<ShipmentFlowGiglPanel {...base} quote={null} state="idle" />);

    const option = screen.getByRole('radio', { name: /Ship with GIG/ });
    expect(option.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(option);
    expect(actions.onModeChange).toHaveBeenCalledOnce();
  });

  it('disables duplicate funding consent while provisioning is in flight', () => {
    render(<ShipmentFlowGiglPanel {...base} selected state="funding" />);
    expect(screen.getByRole('button', { name: 'Fund wallet' })).toHaveProperty(
      'disabled',
      true
    );
  });

  it('offers a funding status refresh while DVA provisioning is pending', () => {
    render(
      <ShipmentFlowGiglPanel {...base} selected state="funding_pending" />
    );
    expect(screen.queryByRole('button', { name: 'Fund wallet' })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Check funding status' })
    );
    expect(actions.onRefreshFundingAccount).toHaveBeenCalledOnce();
  });

  it('keeps funding actions hidden while the preview is shown for Self Fulfill', () => {
    render(<ShipmentFlowGiglPanel {...base} selected={false} />);
    expect(screen.queryByRole('button', { name: 'Fund wallet' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: "I've transferred" })
    ).toBeNull();
  });

  it('hides active DVA details when Self Fulfill is selected', () => {
    render(
      <ShipmentFlowGiglPanel
        {...base}
        selected={false}
        fundingAccount={{
          accountName: 'BACI / Store',
          accountNumber: '1234567890',
          bankName: 'Wema Bank',
          currency: 'NGN',
          status: 'active',
        }}
      />
    );
    expect(screen.queryByText('Wema Bank')).toBeNull();
    expect(screen.queryByText('1234567890')).toBeNull();
    expect(
      screen.queryByRole('button', { name: "I've transferred" })
    ).toBeNull();
  });
});
