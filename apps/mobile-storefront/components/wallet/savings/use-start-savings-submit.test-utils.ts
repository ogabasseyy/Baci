import { jest } from '@jest/globals';

export function createInput(overrides = {}) {
  return {
    activeMerchantId: 'merchant-1',
    activeMerchantSlug: 'ogabassey',
    contributionValue: 20000,
    effectiveInitialContribution: 20000,
    frequency: 'daily' as const,
    fundingAccount: { account_number: '0123456789' },
    initialContributionIdempotencyKey: null,
    goalIdempotencyKey: null,
    setGoalIdempotencyKey: jest.fn(),
    maturityDate: '2026-06-30',
    preferredDebitTime: '06:20',
    refetch: jest.fn(async () => undefined),
    requiredTopUpAmount: 50000,
    selectedPaymentMethodId: null,
    selectedProduct: {
      id: 'product-1',
      image: 'https://example.com/iphone.jpg',
      name: 'iPhone 13 Pro Max',
      price: 800000,
      slug: 'iphone-13-pro-max',
      requiresVariantSelection: false,
      variantId: null,
    },
    setFormError: jest.fn(),
    setInitialContributionIdempotencyKey: jest.fn(),
    setShowFundingModal: jest.fn(),
    setShowPreviewModal: jest.fn(),
    setShowSuccessModal: jest.fn(),
    setShowTransferModal: jest.fn(),
    sourceMode: 'manual' as const,
    startDate: '2026-05-22',
    targetValue: 800000,
    ...overrides,
  };
}
