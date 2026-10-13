import { expect, it } from '@jest/globals';
import type { SavingsProductChoice } from './start-savings.types';
import { validateStartSavingsForm } from './start-savings-controller.utils';

it.each([
  'requiresVariantSelection',
  'variantId',
])('rejects a choice missing %s rather than accepting an unintended base product', (field) => {
  const selectedProduct: SavingsProductChoice = {
    id: 'multi-variant-product',
    image: '',
    name: 'Device',
    price: 100,
    slug: 'device',
    requiresVariantSelection: false,
    variantId: 'variant-1',
  };
  Reflect.deleteProperty(selectedProduct, field);
  const result = validateStartSavingsForm({
    acceptsNonWithdrawableTerms: true,
    contributionValue: 10,
    initialContributionEnabled: false,
    initialContributionValue: 0,
    paymentProvider: 'paystack',
    selectedProduct,
    sourceMode: 'manual',
    targetValue: 100,
  });
  expect(result).toBe('Select the exact device variant you want to save for.');
});
