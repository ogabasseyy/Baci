import { describe, expect, it } from 'vitest';
import {
  FALLBACK_RENDERED_IMAGE_COUNT,
  PRODUCTS_PER_PAGE,
} from './home-product-grid-constants';

describe('home-product-grid-constants', () => {
  it('keeps the fallback image count a small positive slice', () => {
    expect(Number.isInteger(FALLBACK_RENDERED_IMAGE_COUNT)).toBe(true);
    expect(FALLBACK_RENDERED_IMAGE_COUNT).toBeGreaterThan(0);
    // The swap-tier predicate disables AVIF only below this count, so it
    // must stay well under a page: placeholder cards keep AVIF.
    expect(FALLBACK_RENDERED_IMAGE_COUNT).toBeLessThan(PRODUCTS_PER_PAGE);
  });

  it('keeps the page size positive', () => {
    expect(Number.isInteger(PRODUCTS_PER_PAGE)).toBe(true);
    expect(PRODUCTS_PER_PAGE).toBeGreaterThan(0);
  });
});
