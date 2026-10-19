import { describe, expect, it } from 'vitest';
import { evaluateCategoryProductCanonicalRoute } from './category-product-canonicalization';

describe('evaluateCategoryProductCanonicalRoute', () => {
  it.each([
    {
      name: 'treats category aliases as the same route',
      identity: {
        requestedCategorySlug: 'phones',
        requestedProductSlug: 'phone-x',
        resolvedCategorySlug: 'smartphones',
        resolvedProductSlug: 'phone-x',
      },
      expected: { categoryMismatch: false, needsValuesRedirect: false },
    },
    {
      name: 'flags a different category and a case-only product slug change',
      identity: {
        requestedCategorySlug: 'tablets',
        requestedProductSlug: 'Phone-X',
        resolvedCategorySlug: 'smartphones',
        resolvedProductSlug: 'phone-x',
      },
      expected: { categoryMismatch: true, needsValuesRedirect: true },
    },
    {
      name: 'does not redirect a genuinely different product slug',
      identity: {
        requestedCategorySlug: 'phones',
        requestedProductSlug: 'other-product',
        resolvedCategorySlug: 'smartphones',
        resolvedProductSlug: 'phone-x',
      },
      expected: { categoryMismatch: false, needsValuesRedirect: false },
    },
    {
      name: 'does not redirect UUID routes to the resolved product slug',
      identity: {
        requestedCategorySlug: 'phones',
        requestedProductSlug: '11111111-1111-1111-1111-111111111111',
        resolvedCategorySlug: 'smartphones',
        resolvedProductSlug: 'phone-x',
      },
      expected: { categoryMismatch: false, needsValuesRedirect: false },
    },
    {
      name: 'does not mark an absent resolved category or slug as a mismatch',
      identity: {
        requestedCategorySlug: 'phones',
        requestedProductSlug: 'phone-x',
        resolvedCategorySlug: null,
        resolvedProductSlug: null,
      },
      expected: { categoryMismatch: false, needsValuesRedirect: false },
    },
  ])('$name', ({ identity, expected }) => {
    expect(evaluateCategoryProductCanonicalRoute(identity)).toEqual(expected);
  });
});
