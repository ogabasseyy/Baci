import {
  contributionAboveTargetMessage,
  validateStartSavingsForm,
} from './start-savings-controller.utils';

const valid = {
  acceptsNonWithdrawableTerms: true,
  contributionValue: 2000,
  initialContributionEnabled: false,
  initialContributionValue: 0,
  paymentProvider: 'paystack',
  selectedProduct: {
    id: 'phone',
    name: 'Phone',
    image: '',
    slug: 'phone',
    price: 250000,
    variantId: null,
    requiresVariantSelection: false,
  },
  sourceMode: 'manual' as const,
  targetValue: 250000,
};

describe('start savings validation with PiggyVest off', () => {
  it('accepts a contribution up to the target', () => {
    expect(validateStartSavingsForm(valid)).toBeNull();
    expect(
      validateStartSavingsForm({ ...valid, contributionValue: 250000 })
    ).toBeNull();
  });

  describe('bugfix: a contribution bigger than the target was accepted', () => {
    it('refuses ₦82,000,000 a day for a ₦250,000 phone', () => {
      expect(
        validateStartSavingsForm({ ...valid, contributionValue: 82_000_000 })
      ).toMatch(/can’t be more than the phone’s price/);
    });
  });

  it('says nothing when there is no target to compare with', () => {
    expect(contributionAboveTargetMessage(5000, 0)).toBeNull();
    expect(contributionAboveTargetMessage(Number.NaN, 1000)).toBeNull();
  });
});
