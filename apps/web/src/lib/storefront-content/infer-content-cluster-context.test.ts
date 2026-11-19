import { describe, expect, it } from 'vitest';
import { inferContentClusterContext } from '@/lib/storefront-content/infer-content-cluster-context';

describe('inferContentClusterContext', () => {
  it('infers smartphones best-in-nigeria context from blog metadata', () => {
    expect(
      inferContentClusterContext({
        title: 'Best Phones in Nigeria for 2026',
        excerpt: 'Affordable Android and iPhone picks',
        category: 'Smartphones',
        tags: ['budget', 'iphone'],
        keywords: ['android', 'battery'],
      })
    ).toMatchObject({
      categorySlug: 'smartphones',
      kind: 'best-in-nigeria',
      brands: ['apple'],
    });
  });

  it('infers expanded Ogabassey verticals from category and article terms', () => {
    expect(
      inferContentClusterContext({
        title: 'JBL Charge 6 vs Soundbar: Which Audio Device Fits Your Room?',
        excerpt: 'Bluetooth speaker and soundbar buying guide.',
        category: 'Audio',
        tags: ['jbl', 'speaker'],
        keywords: ['bluetooth', 'soundbar'],
      })
    ).toMatchObject({
      categorySlug: 'audio',
      kind: 'decision-support',
      brands: ['jbl'],
    });

    expect(
      inferContentClusterContext({
        title: 'HP LaserJet Printer Setup and Toner Buying Guide',
        excerpt: 'Wireless office printer maintenance and cartridge context.',
        category: 'Printers',
        tags: ['hp', 'printer'],
        keywords: ['toner', 'wireless'],
      })
    ).toMatchObject({
      categorySlug: 'printers',
      kind: 'buyer-guide',
      brands: ['hp'],
    });

    expect(
      inferContentClusterContext({
        title: 'PlayStation 5 Disc Edition vs Digital Edition',
        excerpt: 'PS5 console bundle decision guide.',
        category: 'PlayStation 5',
        tags: ['ps5', 'playstation'],
        keywords: ['console', 'dualsense'],
      })
    ).toMatchObject({
      categorySlug: 'playstation-5',
      kind: 'decision-support',
      brands: ['playstation'],
    });
  });

  it('infers alternatives and what-to-buy-instead articles as decision support', () => {
    expect(
      inferContentClusterContext({
        title: '4 Practical Alternatives to the iPhone 15 in 2026',
        excerpt: 'Compare practical iPhone 15 alternatives in Nigeria.',
        category: 'Smartphones',
        tags: ['iPhone 15', 'iPhone alternatives'],
        keywords: ['what to buy instead of iPhone 15'],
      })
    ).toMatchObject({
      categorySlug: 'smartphones',
      kind: 'decision-support',
      brands: ['apple'],
    });

    expect(
      inferContentClusterContext({
        title: 'Moving On from iPhone XR: What to Buy Next',
        excerpt: 'Upgrade from iPhone XR to newer iPhones.',
        category: 'Smartphones',
        tags: ['iPhone XR', 'Apple'],
        keywords: ['upgrade from iPhone XR'],
      })
    ).toMatchObject({
      categorySlug: 'smartphones',
      kind: 'decision-support',
      brands: ['apple'],
    });
  });

  it('returns nulls when category and intent cannot be inferred', () => {
    expect(
      inferContentClusterContext({
        title: 'Store update',
        excerpt: 'General merchant news',
        category: 'News',
        tags: ['launch'],
        keywords: ['update'],
      })
    ).toMatchObject({
      categorySlug: null,
      kind: null,
      brands: [],
      matchedPriceBands: [],
    });
  });

  it('does not infer ASUS from ROG inside ordinary words', () => {
    expect(
      inferContentClusterContext({
        title: 'Progression and roguelike strategy tips',
        excerpt: 'A practical guide to improving your run.',
        category: 'Gaming',
        tags: ['progress'],
        keywords: ['roguelike'],
      }).brands
    ).not.toContain('asus');
  });

  it('deduplicates brand matches when the post spans multiple supported categories', () => {
    expect(
      inferContentClusterContext({
        title: 'Samsung phones, Samsung TVs, and the best Samsung picks',
        excerpt: 'Comparing Samsung devices across categories',
        category: 'Reviews',
        tags: ['samsung'],
        keywords: ['smartphones', 'smart tvs'],
      }).brands
    ).toEqual(['samsung']);
  });

  it('normalizes currency-bearing metadata across all post fields', () => {
    const context = inferContentClusterContext({
      title: 'Best $50 Samsung Galaxy Watch deals',
      excerpt: 'Compare US100 smartwatch options.',
      category: 'Smartwatches',
      tags: ['£200 Galaxy Watch'],
      keywords: ['₦300 watch'],
    });

    expect(context).toMatchObject({
      categorySlug: 'smartwatches',
      brands: ['samsung'],
    });
    expect(context.tokens).toEqual(
      expect.arrayContaining(['usd', '50', '100', 'gbp', '200', 'ngn', '300'])
    );
  });

  it('applies joined-title corrections before alias-only brand inference', () => {
    expect(
      inferContentClusterContext({
        title: 'AirPod 2 Buyer Guide',
        excerpt: 'Which generation should you buy?',
        category: 'Audio',
        tags: [],
        keywords: [],
      }).brands
    ).toContain('apple');
  });

  it('prefers the most specific explicit category alias over generic parent aliases', () => {
    expect(
      inferContentClusterContext({
        title: 'RTX Gaming Laptop Buying Guide',
        excerpt: 'Gaming notebooks with RTX graphics.',
        category: 'Gaming Laptops',
        tags: ['rtx', 'laptops'],
        keywords: ['gaming laptops'],
      }).categorySlug
    ).toBe('gaming-laptops');

    expect(
      inferContentClusterContext({
        title: 'Nintendo Switch 2 Launch Bundle Guide',
        excerpt: 'Console bundle context for buyers.',
        category: 'Nintendo Switch 2',
        tags: ['switch', 'switch 2'],
        keywords: ['console'],
      }).categorySlug
    ).toBe('nintendo-switch-2');
  });

  it('does not infer gaming as a brand for generic gaming or game articles, but infers real gaming brands', () => {
    const genericGaming = inferContentClusterContext({
      title: 'Top Gaming Setups and Game Tips for 2026',
      excerpt: 'Essential advice for console gaming and game performance.',
      category: 'Gaming',
      tags: ['gaming', 'game'],
      keywords: ['gaming', 'game'],
    });
    expect(genericGaming.brands).toEqual([]);
    expect(genericGaming.categorySlug).toBe('gaming');

    const realBrandGaming = inferContentClusterContext({
      title: 'PlayStation 5 vs Nintendo Switch vs Xbox Series X',
      excerpt:
        'Comparing the big three gaming consoles with Asus ROG Ally and Steam Deck.',
      category: 'Gaming',
      tags: ['ps5', 'switch', 'xbox', 'asus', 'steam'],
      keywords: ['playstation', 'nintendo', 'xbox', 'rog', 'steam deck'],
    });
    expect(realBrandGaming.brands).toEqual(
      expect.arrayContaining([
        'playstation',
        'nintendo',
        'xbox',
        'asus',
        'steam',
      ])
    );
    expect(realBrandGaming.brands).not.toContain('gaming');
  });

  it('infers brand tokens for acer, razer, and gigabyte under plain laptops category', () => {
    const acerLaptop = inferContentClusterContext({
      title: 'Acer Swift 3 vs Aspire 5 for Nigerian Students',
      excerpt:
        'Comparing lightweight Acer notebooks for school and light work.',
      category: 'Laptops',
      tags: ['laptops', 'acer'],
      keywords: ['acer', 'swift', 'aspire'],
    });
    expect(acerLaptop.categorySlug).toBe('laptops');
    expect(acerLaptop.brands).toContain('acer');

    const razerLaptop = inferContentClusterContext({
      title: 'Razer Book 13 Productivity Laptop Review',
      excerpt: 'Compact ultrabook performance and display test.',
      category: 'Laptops',
      tags: ['laptops', 'razer'],
      keywords: ['razer', 'ultrabook'],
    });
    expect(razerLaptop.categorySlug).toBe('laptops');
    expect(razerLaptop.brands).toContain('razer');

    const gigabyteLaptop = inferContentClusterContext({
      title: 'Gigabyte Aero 14 Creator Laptop Review',
      excerpt: 'OLED screen and fast rendering for designers.',
      category: 'Laptops',
      tags: ['laptops', 'gigabyte'],
      keywords: ['gigabyte', 'creator'],
    });
    expect(gigabyteLaptop.categorySlug).toBe('laptops');
    expect(gigabyteLaptop.brands).toContain('gigabyte');
  });

  it('maps singular Gaming Laptop category to gaming-laptops with non-dedicated title', () => {
    const post = inferContentClusterContext({
      title: 'Best Budget Picks for Gamers in Nigeria',
      excerpt:
        'Affordable portable machines with solid graphics for casual gaming.',
      category: 'Gaming Laptop',
      tags: ['budget', 'nigeria'],
      keywords: ['budget', 'gaming'],
    });
    expect(post.categorySlug).toBe('gaming-laptops');
  });
});
