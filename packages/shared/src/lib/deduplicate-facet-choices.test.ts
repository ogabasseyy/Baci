import { expect, it } from 'vitest';
import { deduplicateFacetChoices } from './deduplicate-facet-choices';

it('dedupes facet choices keeping the first spelling', () => {
  expect(
    deduplicateFacetChoices(['Apple', 'Samsung', 'apple', ' APPLE '])
  ).toEqual(['Apple', 'Samsung']);
});
