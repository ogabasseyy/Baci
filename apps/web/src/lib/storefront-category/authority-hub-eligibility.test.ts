import { describe, expect, it } from 'vitest';
import {
  resolveBrandAuthorityEligibility,
  resolveFamilyAuthorityEligibility,
} from './authority-hub-eligibility';
import { brandAuthorityTaxonomy } from './brand-authority-taxonomy';
import { modelFamilyAuthorityTaxonomy } from './model-family-authority-taxonomy';

const apple = brandAuthorityTaxonomy.getEntry('smartphones', 'apple');
const iphone = modelFamilyAuthorityTaxonomy.getEntry(
  'smartphones',
  'apple',
  'iphone-15'
);
if (!apple || !iphone) throw new Error('Expected maintained Apple taxonomy');

const row = (index: number) => ({
  id: `phone-${index}`,
  name: `iPhone 15 ${index}`,
  brand: 'Apple',
  price: 100000,
  stock: 0,
  manage_stock: false,
});

describe('authority hub eligibility contract', () => {
  it('normalizes unmanaged zero-stock products exactly as destination pages do', () => {
    const decision = resolveBrandAuthorityEligibility(
      Array.from({ length: apple.minimumProducts }, (_, index) => row(index)),
      'smartphones',
      apple
    );
    expect(decision.eligible).toBe(true);
    expect(decision.productCount).toBe(apple.minimumProducts);
    expect(
      resolveFamilyAuthorityEligibility(decision.products, iphone).eligible
    ).toBe(true);
  });

  it('rejects malformed rows, wrong brands, and managed unavailable rows', () => {
    const decision = resolveBrandAuthorityEligibility(
      [
        ...Array.from({ length: apple.minimumProducts - 1 }, (_, index) =>
          row(index)
        ),
        { ...row(20), manage_stock: true },
        { ...row(21), brand: 'Samsung' },
        { name: 'iPhone 15' },
        null,
      ],
      'smartphones',
      apple
    );
    expect(decision.eligible).toBe(false);
    expect(decision.productCount).toBe(apple.minimumProducts - 1);
  });

  it('uses the family threshold on the complete parent pool before display limits', () => {
    const products = Array.from(
      { length: iphone.minimumProducts },
      (_, index) => row(index)
    );
    expect(resolveFamilyAuthorityEligibility(products, iphone).eligible).toBe(
      true
    );
    expect(
      resolveFamilyAuthorityEligibility(products.slice(1), iphone).eligible
    ).toBe(false);
  });
});
