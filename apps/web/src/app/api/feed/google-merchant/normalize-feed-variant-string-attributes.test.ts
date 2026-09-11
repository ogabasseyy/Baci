import { expect, it } from 'vitest';
import { normalizeFeedVariantStringAttributes } from './normalize-feed-variant-string-attributes';

it('only includes nonblank string attributes', () => {
  expect(
    normalizeFeedVariantStringAttributes({
      color: ' White ',
      storage: 128,
      blank: ' ',
    })
  ).toEqual({ color: 'White' });
  expect(normalizeFeedVariantStringAttributes(null)).toBeNull();
});
