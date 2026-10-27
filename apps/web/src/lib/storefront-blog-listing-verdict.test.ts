import { describe, expect, it } from 'vitest';
import type { BlogListingStatusIntent } from './cached-storefront-blog-listing-status';
import { makeBlogListingRow as makeRow } from './storefront-blog-listing-status.test-utils';
import {
  evaluateBlogListingRequest,
  resolveBlogListingVerdict,
} from './storefront-blog-listing-verdict';

describe('resolveBlogListingVerdict — category-query (308 canonicalization)', () => {
  it('308-redirects a known clean ?category= to its clean hub', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'category-query',
      category: 'Smartphones',
    };
    expect(resolveBlogListingVerdict(intent, makeRow())).toEqual({
      kind: 'redirect',
      redirectPath: '/blog/category/smartphones',
      status: 308,
    });
  });

  it('308-redirects News to /blog/category/tech-news for Ogabassey tenants', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'category-query',
      category: 'News',
    };
    const row = makeRow({
      categories: ['Tech News', 'Smartphones'],
      category_counts: [5, 10],
    });

    expect(resolveBlogListingVerdict(intent, row, 'ogabassey')).toEqual({
      kind: 'redirect',
      redirectPath: '/blog/category/tech-news',
      status: 308,
    });
    expect(
      evaluateBlogListingRequest({
        intent,
        row,
        identifier: 'ogabassey.com',
      })
    ).toEqual({
      kind: 'redirect',
      redirectPath: '/blog/category/tech-news',
      status: 308,
    });
  });

  it('308-redirects Review to /blog/category/reviews for Ogabassey tenants', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'category-query',
      category: 'Review',
    };
    const row = makeRow({
      categories: ['Reviews', 'Smartphones'],
      category_counts: [5, 10],
    });

    expect(resolveBlogListingVerdict(intent, row, 'ogabassey.com')).toEqual({
      kind: 'redirect',
      redirectPath: '/blog/category/reviews',
      status: 308,
    });
  });

  it('is a NOOP for News or Review aliases on non-Ogabassey tenants', () => {
    const newsIntent: BlogListingStatusIntent = {
      kind: 'category-query',
      category: 'News',
    };
    const reviewIntent: BlogListingStatusIntent = {
      kind: 'category-query',
      category: 'Review',
    };
    const row = makeRow({
      categories: ['Tech News', 'Reviews'],
      category_counts: [5, 10],
    });

    expect(resolveBlogListingVerdict(newsIntent, row, 'other-store')).toEqual({
      kind: 'noop',
    });
    expect(resolveBlogListingVerdict(reviewIntent, row, 'other-store')).toEqual(
      {
        kind: 'noop',
      }
    );
  });

  it('is a NOOP for a ?category= not among the published categories', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'category-query',
      category: 'Tablets',
    };
    expect(resolveBlogListingVerdict(intent, makeRow())).toEqual({
      kind: 'noop',
    });
  });

  it('is a NOOP for a colliding category slug (no clean target)', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'category-query',
      category: 'Smart Phones',
    };
    expect(resolveBlogListingVerdict(intent, makeRow())).toEqual({
      kind: 'noop',
    });
  });

  it('is a NOOP for a blank category', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'category-query',
      category: '   ',
    };
    expect(resolveBlogListingVerdict(intent, makeRow())).toEqual({
      kind: 'noop',
    });
  });

  it('is a NOOP for a reserved clean slug (product) that never canonicalizes', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'category-query',
      category: 'Product',
    };
    const row = makeRow({ categories: ['Product'], category_counts: [4] });
    expect(resolveBlogListingVerdict(intent, row)).toEqual({ kind: 'noop' });
  });

  it('is a NOOP when the blog feature is disabled', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'category-query',
      category: 'Smartphones',
    };
    expect(
      resolveBlogListingVerdict(intent, makeRow({ blog_enabled: false }))
    ).toEqual({ kind: 'noop' });
  });
});

describe('resolveBlogListingVerdict — listing-page (307 clamp)', () => {
  it('clamps an out-of-range page to the last page of the full listing', () => {
    const intent: BlogListingStatusIntent = { kind: 'listing-page', page: 999 };
    expect(resolveBlogListingVerdict(intent, makeRow())).toEqual({
      kind: 'redirect',
      redirectPath: '/blog?page=43',
      status: 307,
    });
  });

  it('leaves an in-range page alone', () => {
    const intent: BlogListingStatusIntent = { kind: 'listing-page', page: 2 };
    expect(resolveBlogListingVerdict(intent, makeRow())).toEqual({
      kind: 'noop',
    });
  });

  it('clamps to page 1 (never ?page=0) when the listing is empty', () => {
    const intent: BlogListingStatusIntent = { kind: 'listing-page', page: 2 };
    expect(
      resolveBlogListingVerdict(intent, makeRow({ total_count: 0 }))
    ).toEqual({
      kind: 'redirect',
      redirectPath: '/blog',
      status: 307,
    });
  });

  it('clamps an out-of-range query-category page to the category query URL', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'listing-page',
      page: 999,
      category: 'Smartphones',
    };
    expect(resolveBlogListingVerdict(intent, makeRow())).toEqual({
      kind: 'redirect',
      redirectPath: '/blog?category=Smartphones&page=19',
      status: 307,
    });
  });

  it('clamps a query-category with zero posts to page 1 of that category', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'listing-page',
      page: 5,
      category: 'Nonexistent',
    };
    expect(resolveBlogListingVerdict(intent, makeRow())).toEqual({
      kind: 'redirect',
      redirectPath: '/blog?category=Nonexistent',
      status: 307,
    });
  });

  it('is a NOOP when the blog feature is disabled', () => {
    const intent: BlogListingStatusIntent = { kind: 'listing-page', page: 999 };
    expect(
      resolveBlogListingVerdict(intent, makeRow({ blog_enabled: false }))
    ).toEqual({ kind: 'noop' });
  });
});

describe('resolveBlogListingVerdict — category-page (307 clamp)', () => {
  it('clamps an out-of-range clean-category page to the category query URL', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'category-page',
      categorySlug: 'smartphones',
      page: 999,
    };
    expect(resolveBlogListingVerdict(intent, makeRow())).toEqual({
      kind: 'redirect',
      redirectPath: '/blog?category=Smartphones&page=19',
      status: 307,
    });
  });

  it('clamps an empty clean-category to page 1 of the category query URL', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'category-page',
      categorySlug: 'laptops',
      page: 2,
    };
    const row = makeRow({ categories: ['Laptops'], category_counts: [0] });
    expect(resolveBlogListingVerdict(intent, row)).toEqual({
      kind: 'redirect',
      redirectPath: '/blog?category=Laptops',
      status: 307,
    });
  });

  it('is a NOOP for an unknown clean category slug (route 404s it itself)', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'category-page',
      categorySlug: 'nonexistent',
      page: 2,
    };
    expect(resolveBlogListingVerdict(intent, makeRow())).toEqual({
      kind: 'noop',
    });
  });

  it('leaves an in-range clean-category page alone', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'category-page',
      categorySlug: 'reviews',
      page: 2,
    };
    // Reviews=15 → 2 pages; page 2 is in range.
    expect(resolveBlogListingVerdict(intent, makeRow())).toEqual({
      kind: 'noop',
    });
  });

  it('counts by the RAW category key so an untrimmed DB value clamps like .eq() does', () => {
    // The label match trims (` Reviews ` → `Reviews`) but the count key stays
    // the raw untrimmed value, so the exact-string lookup misses → 0 → clamp,
    // exactly as getCachedBlogListing({ category: 'Reviews' }) would.
    const intent: BlogListingStatusIntent = {
      kind: 'category-page',
      categorySlug: 'reviews',
      page: 2,
    };
    const row = makeRow({ categories: [' Reviews '], category_counts: [15] });
    expect(resolveBlogListingVerdict(intent, row)).toEqual({
      kind: 'redirect',
      redirectPath: '/blog?category=Reviews',
      status: 307,
    });
  });
});

describe('resolveBlogListingVerdict — author', () => {
  it('clamps out-of-range author pagination to the last page', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'author',
      authorSlug: 'bassey-john',
      page: 999,
    };
    // 287 posts → 24 pages.
    expect(
      resolveBlogListingVerdict(intent, makeRow({ author_count: 287 }))
    ).toEqual({
      kind: 'redirect',
      redirectPath: '/blog/author/bassey-john?page=24',
      status: 307,
    });
  });

  it('lowercases a mixed-case author slug in the clamp redirect', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'author',
      authorSlug: 'Bassey-John',
      page: 999,
    };
    expect(
      resolveBlogListingVerdict(intent, makeRow({ author_count: 287 }))
    ).toEqual({
      kind: 'redirect',
      redirectPath: '/blog/author/bassey-john?page=24',
      status: 307,
    });
  });

  it('clamps to the bare author URL (no ?page=) when there is a single page', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'author',
      authorSlug: 'bolakale',
      page: 3,
    };
    expect(
      resolveBlogListingVerdict(intent, makeRow({ author_count: 5 }))
    ).toEqual({
      kind: 'redirect',
      redirectPath: '/blog/author/bolakale',
      status: 307,
    });
  });

  it('is a NOOP for an in-range author page', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'author',
      authorSlug: 'bassey-john',
      page: 1,
    };
    expect(
      resolveBlogListingVerdict(intent, makeRow({ author_count: 287 }))
    ).toEqual({ kind: 'noop' });
  });

  it('returns notFound for a known author with zero published posts', () => {
    const intent: BlogListingStatusIntent = {
      kind: 'author',
      authorSlug: 'bassey-john',
      page: 1,
    };
    expect(
      resolveBlogListingVerdict(intent, makeRow({ author_count: 0 }))
    ).toEqual({ kind: 'notFound' });
  });

  it('returns notFound for an author when the blog feature is disabled', () => {
    // getCachedBlogAuthor returns null for a blog-disabled store, which the
    // resolver maps to a real 404 — asymmetric with the other intents' NOOP.
    const intent: BlogListingStatusIntent = {
      kind: 'author',
      authorSlug: 'bassey-john',
      page: 1,
    };
    expect(
      resolveBlogListingVerdict(
        intent,
        makeRow({ blog_enabled: false, author_count: 287 })
      )
    ).toEqual({ kind: 'notFound' });
  });
});
