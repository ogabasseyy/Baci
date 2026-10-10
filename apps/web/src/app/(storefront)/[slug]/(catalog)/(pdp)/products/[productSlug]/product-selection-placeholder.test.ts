import { expect, it } from 'vitest';
import { PLACEHOLDER_IMAGE } from './product-selection-placeholder';

it('points at the shared placeholder asset', () => {
  expect(PLACEHOLDER_IMAGE).toBe('/placeholder.svg');
});
