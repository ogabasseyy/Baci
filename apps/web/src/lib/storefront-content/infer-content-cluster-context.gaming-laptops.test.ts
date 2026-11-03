import { describe, expect, it } from 'vitest';
import { inferContentClusterContext } from './infer-content-cluster-context';

describe('inferContentClusterContext - gaming laptops', () => {
  it('infers gaming-laptops categorySlug for gaming laptop articles under Gaming or Laptops', () => {
    for (const [title, category, tags] of [
      ['HP Omen 16 Specs in Nigeria', 'Gaming', ['omen', 'gaming laptop']],
      ['Gaming Laptops: Alienware vs ROG', 'Gaming', ['alienware', 'rog']],
      ['Best Gaming Laptops in Nigeria', 'Laptops', ['laptops', 'budget']],
      ['ASUS ROG RTX 4060 Laptop Review', 'Laptops', ['laptops', 'asus']],
    ] as const) {
      const post = inferContentClusterContext({
        title,
        excerpt: null,
        category,
        tags: [...tags],
        keywords: ['buyer guide'],
      });
      expect(post.categorySlug).toBe('gaming-laptops');
    }
  });

  it('keeps Gaming category for gaming monitors with msi and refresh rate tokens without promoting to gaming-laptops', () => {
    const monitorPost = inferContentClusterContext({
      title: 'MSI Optix 144Hz Gaming Monitor: Refresh Rate and Display Review',
      excerpt:
        'A comprehensive review of the 144Hz refresh rate IPS display from MSI.',
      category: 'Gaming',
      tags: ['gaming', 'msi', 'refresh rate', 'monitors'],
      keywords: ['msi', 'refresh rate', 'gaming monitor'],
    });
    expect(monitorPost.categorySlug).toBe('gaming');
  });

  it('keeps Laptops category for student laptop guides mentioning gaming lines only in tags or excerpt', () => {
    const studentLaptopGuide = inferContentClusterContext({
      title: 'Best Student Laptops in Nigeria: 2026',
      excerpt:
        'Comparing lightweight notebooks for school against Legion options.',
      category: 'Laptops',
      tags: ['laptops', 'students', 'legion', 'omen'],
      keywords: ['buyer guide', 'school'],
    });
    expect(studentLaptopGuide.categorySlug).toBe('laptops');
  });

  it('keeps Gaming and Laptops categories for monitor articles even when title mentions gaming laptop setup', () => {
    for (const [title, category] of [
      ['Best Monitors for a Gaming Laptop Setup', 'Gaming'],
      ['Best Monitors for Gaming Laptops: Pairing Guide', 'Gaming'],
      ['Top 5 Monitors for Your Gaming Laptop in 2026', 'Laptops'],
    ]) {
      const post = inferContentClusterContext({
        title,
        excerpt: 'High refresh rate external displays for laptop gamers.',
        category,
        tags: [category.toLowerCase(), 'monitors', 'gaming laptop'],
        keywords: ['buyer guide'],
      });
      expect(post.categorySlug).toBe(category.toLowerCase());
    }
  });

  it('keeps Gaming and Laptops categories for desktop and GPU articles with dedicated gaming tokens and laptop metadata', () => {
    for (const [title, category, tags] of [
      [
        'Alienware Aurora R16 Gaming Desktop Review',
        'Laptops',
        ['laptops', 'alienware', 'gaming', 'desktop'],
      ],
      [
        'Nvidia RTX 5080 GPU Guide and Benchmark',
        'Gaming',
        ['gaming', 'rtx', 'laptop'],
      ],
      [
        'GeForce RTX 4080 Graphics Card Buyer Guide',
        'Gaming',
        ['gaming', 'geforce', 'rtx', 'laptop'],
      ],
      ['RTX 5080 GPU Guide', 'Gaming', ['gaming', 'rtx']],
    ] as const) {
      const post = inferContentClusterContext({
        title,
        excerpt: 'Desktop performance compared against mobile laptop GPUs.',
        category,
        tags: [...tags],
        keywords: ['buyer guide'],
      });
      expect(post.categorySlug).toBe(category.toLowerCase());
    }
  });

  it('keeps Gaming and Laptops categories for accessory articles mentioning gaming laptops without promoting to gaming-laptops', () => {
    for (const [title, category, tag] of [
      ['Best Gaming Laptop Accessories in Nigeria', 'Gaming', 'accessories'],
      [
        'Gaming Laptop Cooling Pad Review and Temperature Benchmarks',
        'Laptops',
        'cooling pad',
      ],
      ['Ergonomic Gaming Laptop Stand Buying Guide', 'Gaming', 'stand'],
    ]) {
      const guide = inferContentClusterContext({
        title,
        excerpt: 'Peripherals and gear for mobile gaming setup.',
        category,
        tags: [category.toLowerCase(), tag, 'gaming laptop'],
        keywords: ['buyer guide'],
      });
      expect(guide.categorySlug).toBe(category.toLowerCase());
    }
  });

  it('promotes legitimate gaming laptop roundups with idiomatic phrases or GPUs to gaming-laptops', () => {
    for (const title of [
      'Best Gaming Laptops in Nigeria That Stand Out in 2026',
      'Best Gaming Laptops with RTX 4060 GPUs in Nigeria',
    ]) {
      const post = inferContentClusterContext({
        title,
        excerpt: 'Top-tier portable gaming rigs reviewed and compared.',
        category: 'Gaming',
        tags: ['gaming', 'laptops'],
        keywords: ['buyer guide'],
      });
      expect(post.categorySlug).toBe('gaming-laptops');
    }
  });

  it('promotes dedicated gaming laptop articles for newly supported families (predator, aorus) to gaming-laptops', () => {
    for (const [title, brand, category] of [
      ['Acer Predator Helios 16 Buyer Guide', 'acer', 'Gaming'],
      ['Gigabyte Aorus 16X Buyer Guide', 'gigabyte', 'Gaming'],
      ['Razer Blade 16 Laptop Review', 'razer', 'Laptops'],
      ['Acer Nitro 15 Laptop Review', 'acer', 'Laptops'],
      ['MSI Katana 15 Laptop Review', 'msi', 'Laptops'],
    ]) {
      const guide = inferContentClusterContext({
        title,
        excerpt: 'Mobile gaming review.',
        category,
        tags: [category.toLowerCase(), brand, 'laptop'],
        keywords: ['review'],
      });
      expect(guide.categorySlug).toBe('gaming-laptops');
    }
  });

  it('does not promote desktop, handheld, or standalone GPU articles without laptop evidence under Gaming or Laptops', () => {
    for (const [title, category, tags, expected] of [
      ['Alienware Aurora R16', 'Gaming', ['alienware', 'laptop'], 'gaming'],
      ['Alienware Aurora R16', 'Laptops', ['alienware'], 'laptops'],
      ['GeForce RTX 4080 Buyer Guide', 'Gaming', ['laptops'], 'gaming'],
      ['ASUS ROG Ally X Buying Guide', 'Gaming', ['laptops', 'rog'], 'gaming'],
    ] as const) {
      const res = inferContentClusterContext({
        title,
        excerpt: 'Benchmarked.',
        category,
        tags: [...tags],
        keywords: ['review'],
      });
      expect(res.categorySlug).toBe(expected);
    }
  });

  it('promotes legitimate dedicated-model laptop posts with incidental excluded subjects in metadata tags or keywords', () => {
    const laptopArticle = inferContentClusterContext({
      title: 'Alienware m16 Review',
      excerpt: 'Flagship gaming laptop tested with high refresh rate.',
      category: 'Gaming',
      tags: ['alienware', 'gaming', 'gpu', 'monitor'],
      keywords: ['review', 'gpu', 'monitor'],
    });
    expect(laptopArticle.categorySlug).toBe('gaming-laptops');
  });

  it('classifies unmapped category posts with new gaming laptop families via fallback article token scoring', () => {
    for (const family of ['katana', 'nitro', 'aorus', 'blade']) {
      const post = inferContentClusterContext({
        title: `Hands-on with the new ${family} gaming laptop`,
        excerpt: 'Benchmarking performance and refresh rate.',
        category: 'Hardware Reviews',
        tags: [family],
        keywords: [],
      });
      expect(post.categorySlug).toBe('gaming-laptops');
    }
  });

  it('does not classify gaming laptop accessories, stands, or GPUs as gaming-laptops', () => {
    for (const [title, category, expectedSlug] of [
      ['Top 5 Laptop Stands 2026', 'Laptop Accessories', 'accessories'],
      ['Best Gaming Laptop Stand 2026', 'Gaming Laptops', 'accessories'],
      ['Best Gaming Laptop Cooling Pads in Nigeria', 'Gaming', 'gaming'],
      ['Gaming Laptop Stands Buying Guide', 'Gaming Laptops', 'accessories'],
      ['Gaming Laptop GPU Upgrade Guide', 'Gaming', 'gaming'],
      ['Gaming Laptop Graphics Card Guide', 'Gaming', 'gaming'],
      [
        'Essential Accessories Buyer Guide 2026',
        'Gaming Laptops',
        'accessories',
      ],
    ]) {
      const post = inferContentClusterContext({
        title,
        excerpt: 'Stands, cooling pads, and GPU upgrades.',
        category,
        tags: ['accessories'],
        keywords: ['guide'],
      });
      expect(post.categorySlug).toBe(expectedSlug);
    }
  });

  it('excludes desktop and keyboard subjects in fallback scoring for unmapped categories unless title establishes laptop', () => {
    const cases = [
      [
        'Alienware Aurora R16 Desktop Buyer Guide',
        'Prebuilt tower.',
        ['alienware', 'desktop'],
        'aurora',
        'desktops',
      ],
      [
        'Katana Mechanical Gaming Keyboard Review',
        'RGB mechanical.',
        ['katana', 'keyboard'],
        'keyboard',
        'not-gaming',
      ],
      [
        'Blade Vampire Action Game Review',
        'Action combat.',
        ['blade', 'laptop', 'gaming'],
        'blade',
        'not-gaming',
      ],
      [
        'Razer Blade 16 Review: RTX 4070 Performance',
        'Flagship mobile.',
        ['razer', 'blade', 'laptop'],
        'review',
        'gaming-laptops',
      ],
      [
        'Hands-on with the new Nitro gaming laptop',
        'High refresh rate display.',
        ['nitro', 'gaming laptop'],
        'keyboard',
        'gaming-laptops',
      ],
    ] as const;
    for (const [t, excerpt, tags, kw, exp] of cases) {
      const res = inferContentClusterContext({
        title: t,
        excerpt,
        category: 'Hardware Reviews',
        tags: [...tags],
        keywords: [kw],
      });
      if (exp === 'not-gaming')
        expect(res.categorySlug).not.toBe('gaming-laptops');
      else expect(res.categorySlug).toBe(exp);
    }
  });

  it('preserves legitimate gaming-laptop guides with GPU, desktop-class, pairing, or incidental excerpt tokens', () => {
    for (const [title, kw, excerpt = 'Guide.'] of [
      ['Gaming Laptops with RTX 4060 GPUs in Nigeria', 'gpu'],
      ['Gaming Laptops: Desktop Replacement Guide', 'desktop replacement'],
      ['Alienware m16 Desktop-Class Review', 'desktop-class'],
      ['Gaming Laptops and Monitor Pairings', 'monitors'],
      ['Gaming Laptops with Free Accessories', 'accessories'],
      ['Alienware m16 Laptop Buyer Guide', 'laptops', 'Covers keyboard.'],
      ['Best Gaming Laptops in Nigeria', 'gaming', 'Covers keyboards, GPUs.'],
      ['ASUS ROG Gaming Laptop Battery Life Review', 'battery life'],
    ]) {
      const post = inferContentClusterContext({
        title,
        excerpt,
        category: 'Gaming Laptops',
        tags: ['laptops', 'gaming'],
        keywords: [kw],
      });
      expect(post.categorySlug).toBe('gaming-laptops');
    }
  });
});
