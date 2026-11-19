import { expect, it } from 'vitest';
import { experienceCatalogSelection } from './experience-catalog-selection';

it('accepts bounded catalog locators and rejects caller-selected authority or malformed handles', () => {
  expect(
    experienceCatalogSelection.safeParse({ productSlug: 'synthetic-device' })
      .success
  ).toBe(true);
  for (const input of [
    { productSlug: '../private' },
    { merchantId: 'forged' },
    { productId: 'invalid' },
  ])
    expect(experienceCatalogSelection.safeParse(input).success).toBe(false);
});
