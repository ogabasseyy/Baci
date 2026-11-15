import { vi } from 'vitest';

export const quote = {
  id: 'b2152ea0-831d-4387-b4c1-5dcf29a74c54',
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
};

export function gigl(canBook: boolean, error: string | null = null) {
  return {
    addressDraft: {},
    error,
    ensureFreshQuoteForConfirmation: vi.fn().mockResolvedValue(true),
    fundingAccount: null,
    missingFields: [],
    quote,
    refreshBalance: vi.fn(),
    requestQuote: vi.fn(),
    reset: vi.fn(),
    startFunding: vi.fn(),
    startTransferPoll: vi.fn(),
    state: error ? ('error' as const) : ('ready' as const),
    updateAddressField: vi.fn(),
    selectAddressPlace: vi.fn(),
    wallet: {
      availableBalance: canBook ? 11000 : 1000,
      canBook,
      shortfall: canBook ? 0 : 10000,
    },
  } as never;
}

export const base = {
  canBookGigl: true,
  isGiglOrder: true,
  canUseProvider: false,
  fulfillmentDetails: { imei: '', items: [], serialNumber: '' },
  fulfillmentItemIndex: 0,
  hasExistingFulfillment: false,
  isSubmitting: false,
  onClose: vi.fn(),
  onConfirmSelfFulfillment: vi.fn(),
  onContinueFromDetails: vi.fn(),
  onContinueFromMethod: vi.fn(),
  onFulfillmentDetailsChange: vi.fn(),
  onModeChange: vi.fn(),
  onRiderPhoneChange: vi.fn(),
  onSelectSavedRider: vi.fn(),
  onStepBack: vi.fn(),
  orderNumber: 'ORD-1',
  providerLabel: null,
  requiresFulfillment: false,
  riderPhone: '',
  savedRiders: [],
  selectedMode: 'provider' as const,
  step: 'method' as const,
  visible: true,
};
