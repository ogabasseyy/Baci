import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';
import type {
  BuildCommercialGuideLinksContext,
  PublishedClusterPost,
} from './content-cluster-types';

function post(
  slug: string,
  title: string,
  category: string,
  tags: string[]
): PublishedClusterPost {
  return {
    slug,
    title,
    excerpt: title,
    category,
    tags,
    keywords: ['buyer guide'],
    featured_image_url: null,
    published_at: '2026-04-01T09:00:00.000Z',
    reading_time_minutes: 6,
  };
}

function firstGuide(
  context: BuildCommercialGuideLinksContext,
  posts: PublishedClusterPost[]
) {
  return buildCommercialGuideLinks({
    storeUrl: 'https://ogabassey.com',
    posts,
    context,
  })[0]?.href;
}

describe('buildCommercialGuideLinks model distinctions', () => {
  it('ranks an annual F1 guide above a generic F1 guide', () => {
    const context = {
      pageKind: 'product',
      categorySlug: 'playstation-4',
      brands: ['PlayStation'],
      productSlugs: ['ps4-f1-2024'],
    } satisfies BuildCommercialGuideLinksContext;
    const posts = [
      post('f1-buying-guide', 'PlayStation 4 F1 Buyer Guide', 'PlayStation 4', [
        'playstation',
        'f1',
      ]),
      post(
        'f1-2024-buying-guide',
        'PlayStation 4 F1 2024 Buyer Guide',
        'PlayStation 4',
        ['playstation', 'f1 2024']
      ),
    ];

    expect(firstGuide(context, posts)).toBe(
      'https://ogabassey.com/blog/f1-2024-buying-guide'
    );
  });

  it('ranks an Apple Watch Series 9 guide above a generic watch guide', () => {
    const context = {
      pageKind: 'product',
      categorySlug: 'smartwatches',
      brands: ['Apple'],
      productSlugs: ['apple-watch-series-9-45mm-gps'],
    } satisfies BuildCommercialGuideLinksContext;
    const posts = [
      post(
        'apple-watch-buying-guide',
        'Apple Watch Buyer Guide',
        'Smartwatches',
        ['smartwatches', 'apple']
      ),
      post(
        'apple-watch-series-9-buying-guide',
        'Apple Watch Series 9 Buyer Guide',
        'Smartwatches',
        ['smartwatches', 'apple', 'watch series 9']
      ),
    ];

    expect(firstGuide(context, posts)).toBe(
      'https://ogabassey.com/blog/apple-watch-series-9-buying-guide'
    );
  });

  it('retains a PlayStation sequel number in guide matching', () => {
    const context = {
      pageKind: 'product',
      categorySlug: 'playstation-4',
      brands: ['PlayStation'],
      productSlugs: ['ps4-resident-evil-4-remake'],
    } satisfies BuildCommercialGuideLinksContext;
    const posts = [
      post(
        'resident-evil-buying-guide',
        'Resident Evil Buyer Guide',
        'PlayStation 4',
        ['playstation', 'resident evil']
      ),
      post(
        'resident-evil-4-buying-guide',
        'Resident Evil 4 Remake Buyer Guide',
        'PlayStation 4',
        ['playstation', 'resident evil 4']
      ),
    ];

    expect(firstGuide(context, posts)).toBe(
      'https://ogabassey.com/blog/resident-evil-4-buying-guide'
    );
  });

  it('keeps game words for a Nintendo Switch title', () => {
    const context = {
      pageKind: 'product',
      categorySlug: 'nintendo-switch',
      brands: ['Nintendo'],
      productSlugs: ['nintendo-switch-hasbro-game-night'],
    } satisfies BuildCommercialGuideLinksContext;
    const posts = [
      post(
        'nintendo-switch-game-buying-guide',
        'Nintendo Switch Game Buying Guide',
        'Nintendo Switch',
        ['nintendo', 'switch', 'game']
      ),
      post(
        'hasbro-game-night-buying-guide',
        'Hasbro Game Night Buyer Guide',
        'Nintendo Switch',
        ['nintendo', 'switch', 'hasbro game night']
      ),
    ];

    expect(firstGuide(context, posts)).toBe(
      'https://ogabassey.com/blog/hasbro-game-night-buying-guide'
    );
  });

  it('does not match a Pixel 9 Pro XL guide to the base Pro model', () => {
    const context = {
      pageKind: 'product',
      categorySlug: 'smartphones',
      brands: ['Google'],
      productSlugs: ['google-pixel-9-pro'],
    } satisfies BuildCommercialGuideLinksContext;
    const posts = [
      post(
        'pixel-9-pro-xl-buying-guide',
        'Google Pixel 9 Pro XL Buyer Guide',
        'Smartphones',
        ['smartphones', 'google', 'pixel 9 pro xl']
      ),
      post(
        'pixel-9-pro-buying-guide',
        'Google Pixel 9 Pro Buyer Guide',
        'Smartphones',
        ['smartphones', 'google', 'pixel 9 pro']
      ),
    ];

    expect(firstGuide(context, posts)).toBe(
      'https://ogabassey.com/blog/pixel-9-pro-buying-guide'
    );
  });

  it('matches the conventional ThinkPad X1 Gen 8 guide wording', () => {
    const context = {
      pageKind: 'product',
      categorySlug: 'laptops',
      brands: ['Lenovo'],
      productSlugs: ['lenovo-thinkpad-gen-8-x1-14-inch'],
    } satisfies BuildCommercialGuideLinksContext;
    const posts = [
      post('thinkpad-buyer-guide', 'Lenovo ThinkPad Buyer Guide', 'Laptops', [
        'laptops',
        'lenovo',
        'thinkpad',
      ]),
      post(
        'thinkpad-x1-gen-8-buyer-guide',
        'Lenovo ThinkPad X1 Gen 8 Buyer Guide',
        'Laptops',
        ['laptops', 'lenovo', 'thinkpad x1 gen 8']
      ),
    ];

    expect(firstGuide(context, posts)).toBe(
      'https://ogabassey.com/blog/thinkpad-x1-gen-8-buyer-guide'
    );
  });

  it('keeps Galaxy Buds family context ahead of generic earbud guides', () => {
    const context = {
      pageKind: 'product',
      categorySlug: 'earbuds',
      brands: ['Samsung'],
      productSlugs: ['samsung-galaxy-buds-pro'],
    } satisfies BuildCommercialGuideLinksContext;
    const posts = [
      post(
        'samsung-earbuds-buying-guide',
        'Samsung Earbuds Buyer Guide',
        'Earbuds',
        ['earbuds', 'samsung']
      ),
      post(
        'galaxy-buds-pro-buying-guide',
        'Samsung Galaxy Buds Pro Buyer Guide',
        'Earbuds',
        ['earbuds', 'samsung', 'galaxy buds pro']
      ),
    ];

    expect(firstGuide(context, posts)).toBe(
      'https://ogabassey.com/blog/galaxy-buds-pro-buying-guide'
    );
  });

  it('keeps same-denomination gift-card guides separated by currency', () => {
    const context = {
      pageKind: 'product',
      categorySlug: 'gift-cards',
      productNames: ['PSN Card £50 Gift Card'],
      productSlugs: [],
    } satisfies BuildCommercialGuideLinksContext;
    const posts = [
      post(
        'psn-card-usd-50-guide',
        'PSN Card $50 Gift Card Buyer Guide',
        'Gift Cards',
        ['gift cards', 'psn', 'usd 50']
      ),
      post(
        'psn-card-gbp-50-guide',
        'PSN Card £50 Gift Card Buyer Guide',
        'Gift Cards',
        ['gift cards', 'psn', 'gbp 50']
      ),
    ];

    expect(firstGuide(context, posts)).toBe(
      'https://ogabassey.com/blog/psn-card-gbp-50-guide'
    );
  });

  it('does not promote a standalone phone number without brand context', () => {
    const context = {
      pageKind: 'category',
      categorySlug: 'smartphones',
      brands: ['Apple'],
      productSlugs: ['iphone-15-6gb-256gb-wifi-only'],
    } satisfies BuildCommercialGuideLinksContext;
    const posts = [
      post('15-best-smartphones', '15 Best Smartphones', 'Smartphones', [
        'smartphones',
        'best',
      ]),
      post('14-best-smartphones', '14 Best Smartphones', 'Smartphones', [
        'smartphones',
        'best',
      ]),
    ].map((entry, index) => ({
      ...entry,
      published_at: `2026-04-${String(index + 10).padStart(2, '0')}T09:00:00.000Z`,
    }));

    expect(firstGuide(context, posts)).toBe(
      'https://ogabassey.com/blog/14-best-smartphones'
    );
  });
});
