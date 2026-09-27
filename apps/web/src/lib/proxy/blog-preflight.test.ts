import { describe, expect, it } from 'vitest';
import {
  buildBlogListingIntent,
  parseBlogListingPageParam,
} from './blog-preflight';

describe('blog listing preflight intent', () => {
  it('clamps a listing page and retains its category filter', () => {
    expect(parseBlogListingPageParam('999999')).toBe(10_000);
    expect(
      buildBlogListingIntent(
        ['blog'],
        new URLSearchParams('category=phones&page=4')
      )
    ).toEqual({ kind: 'listing-page', category: 'phones', page: 4 });
  });

  it('does not hard-redirect searchable listings or invalid pages', () => {
    expect(
      buildBlogListingIntent(
        ['blog'],
        new URLSearchParams('search=iphone&page=3')
      )
    ).toBeNull();
    expect(parseBlogListingPageParam('0')).toBeNull();
  });
});
