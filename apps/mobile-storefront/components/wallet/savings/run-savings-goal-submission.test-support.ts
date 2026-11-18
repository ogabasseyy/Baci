import { jest } from '@jest/globals';
import type {
  WalletActiveSavingsGoal,
  WalletQueryData,
} from '@/hooks/wallet-query';
import type { UseStartSavingsSubmitInput } from './run-savings-goal-submission';

/** A successful wallet refetch whose data holds one plan. */
export function loadedWith(goalId: string) {
  // Typed as the real wallet query result, so a renamed or moved field in
  // the wallet envelope breaks this test at compile time.
  const data: WalletQueryData = {
    wallet: {
      balance: 0,
      loyalty_points: 0,
      savings_goals: [{ id: goalId } as WalletActiveSavingsGoal],
    },
    transactions: [],
  };
  return { isError: false, data };
}

export function createInput(overrides = {}): UseStartSavingsSubmitInput {
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
      variantId: 'variant-1',
      requiresVariantSelection: false,
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
    variantId: undefined,
    ...overrides,
  };
}

export const validation = {
  formattedStartDate: '2026-05-22',
  selectedProduct: {
    id: 'product-1',
    image: 'https://example.com/iphone.jpg',
    name: 'iPhone 13 Pro Max',
    price: 800000,
    slug: 'iphone-13-pro-max',
    variantId: 'variant-1',
    requiresVariantSelection: false,
  },
};
