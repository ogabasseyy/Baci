import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
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
      warning: '#CA8A04',
    },
  }),
}));

const actions = {
  onAddressFieldChange: vi.fn(),
  onFundWallet: vi.fn(),
  onRefreshFundingAccount: vi.fn(),
  onModeChange: vi.fn(),
  onPlaceSelect: vi.fn(),
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

it('shows Paid by Baci instead of wallet balance or top-up for platform-funded merchants', () => {
  render(
    <ShipmentFlowGiglPanel
      {...base}
      wallet={{
        availableBalance: 0,
        canBook: true,
        paidByBaci: true,
        shortfall: 0,
      }}
    />
  );
  expect(screen.getByText('₦11,000')).toBeTruthy();
  expect(screen.getByText('Paid by Baci')).toBeTruthy();
  expect(screen.queryByText('From your wallet')).toBeNull();
  expect(screen.queryByText(/Wallet balance|Top up/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Fund wallet' })).toBeNull();
});

it('hides the funding-account panel and polling copy for platform-funded merchants', () => {
  render(
    <ShipmentFlowGiglPanel
      {...base}
      fundingAccount={{
        accountName: 'Shop',
        accountNumber: '0123456789',
        bankName: 'Bank',
        currency: 'NGN',
        status: 'active',
      }}
      selected
      state="polling"
      wallet={{
        availableBalance: 0,
        canBook: true,
        paidByBaci: true,
        shortfall: 0,
      }}
    />
  );
  expect(screen.queryByText('0123456789')).toBeNull();
  expect(screen.queryByText("I've transferred")).toBeNull();
  expect(screen.queryByText(/Checking your wallet balance/)).toBeNull();
});

it('bugfix: hides the funding_pending prompt for platform-funded merchants', () => {
  render(
    <ShipmentFlowGiglPanel
      {...base}
      selected
      state="funding_pending"
      wallet={{
        availableBalance: 0,
        canBook: true,
        paidByBaci: true,
        shortfall: 0,
      }}
    />
  );
  expect(
    screen.queryByText(/bank transfer account is being prepared/)
  ).toBeNull();
  expect(screen.queryByText('Check funding status')).toBeNull();
});
