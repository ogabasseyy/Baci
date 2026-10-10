import { expect, it } from 'vitest';
import { isSameFacetChoice } from './is-same-facet-choice';

it('compares facet choices trimmed and case-insensitively', () => {
  expect(isSameFacetChoice('Apple', 'apple')).toBe(true);
  expect(isSameFacetChoice('  Apple ', 'apple')).toBe(true);
  expect(isSameFacetChoice('Apple', 'Samsung')).toBe(false);
});
