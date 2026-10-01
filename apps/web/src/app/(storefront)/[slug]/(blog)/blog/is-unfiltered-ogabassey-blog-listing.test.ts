import { describe, expect, it } from 'vitest';
import { isUnfilteredOgabasseyBlogListing } from './is-unfiltered-ogabassey-blog-listing';

describe('isUnfilteredOgabasseyBlogListing', () => {
  it('accepts the empty-query static root', () => {
    expect(isUnfilteredOgabasseyBlogListing('ogabassey.com', {})).toBe(true);
    expect(isUnfilteredOgabasseyBlogListing('ogabassey', {})).toBe(true);
  });

  it('rejects pagination, category, and search queries', () => {
    expect(
      isUnfilteredOgabasseyBlogListing('ogabassey.com', { page: '2' })
    ).toBe(false);
    expect(
      isUnfilteredOgabasseyBlogListing('ogabassey.com', { category: 'News' })
    ).toBe(false);
    expect(
      isUnfilteredOgabasseyBlogListing('ogabassey.com', { search: 'iphone' })
    ).toBe(false);
  });

  it('rejects non-static tenants even without query keys', () => {
    expect(
      isUnfilteredOgabasseyBlogListing('another-ogabassey-template-store', {})
    ).toBe(false);
  });
});
