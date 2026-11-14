import { vi } from 'vitest';

export const giglPanelActions = {
  onAddressFieldChange: vi.fn(),
  onFundWallet: vi.fn(),
  onRefreshFundingAccount: vi.fn(),
  onModeChange: vi.fn(),
  onRetryQuote: vi.fn(),
  onPlaceSelect: vi.fn(),
  onTransferred: vi.fn(),
};

export const giglPanelBase = {
  ...giglPanelActions,
  bookingAllowed: true,
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
