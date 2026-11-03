import { describe, expect, it } from 'vitest';
import { inferContentClusterContext } from './infer-content-cluster-context';

describe('inferContentClusterContext - gaming laptops', () => {
  it('infers gaming-laptops categorySlug for gaming laptop articles under Gaming or Laptops', () => {
    for (const [title, category, tags] of [
      [
        'HP Omen 16 (2026): Price in Nigeria, Specs & Where to Buy',
        'Gaming',
        ['gaming', 'hp omen 16', 'gaming laptop'],
      ],
      [
        'Gaming Laptops in Nigeria (2026): Alienware vs ROG vs Legion vs Omen',
        'Gaming',
        ['gaming', 'alienware', 'rog', 'legion', 'omen'],
      ],
      [
        'Best Gaming Laptops in Nigeria (2026)',
        'Laptops',
        ['laptops', 'budget'],
      ],
      [
        'ASUS ROG RTX 4060 Laptop Review and Price in Nigeria',
        'Laptops',
        ['laptops', 'asus'],
      ],
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

  it('promotes legitimate gaming laptop roundups containing idiomatic phrases like "stand out" to gaming-laptops', () => {
    const standOutRoundup = inferContentClusterContext({
      title: 'Best Gaming Laptops in Nigeria That Stand Out in 2026',
      excerpt: 'Top-tier portable gaming rigs reviewed and compared.',
      category: 'Gaming',
      tags: ['gaming', 'laptops'],
      keywords: ['buyer guide'],
    });
    expect(standOutRoundup.categorySlug).toBe('gaming-laptops');
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

  it('promotes legitimate gaming-laptop roundups mentioning GPUs in the title to gaming-laptops', () => {
    const gpuRoundup = inferContentClusterContext({
      title: 'Best Gaming Laptops with RTX 4060 GPUs in Nigeria',
      excerpt: 'Comparing affordable high-refresh-rate gaming laptops.',
      category: 'Gaming',
      tags: ['gaming', 'laptops'],
      keywords: ['buyer guide'],
    });
    expect(gpuRoundup.categorySlug).toBe('gaming-laptops');
  });

  it('does not promote desktop articles tagged "gaming laptop" when the title lacks laptop evidence', () => {
    for (const excerpt of [
      'High-performance gaming desktop benchmarked.',
      '',
    ]) {
      const desktopArticle = inferContentClusterContext({
        title: 'Alienware Aurora R16 Review',
        excerpt,
        category: 'Gaming',
        tags: ['gaming laptop', 'alienware'],
        keywords: ['review'],
      });
      expect(desktopArticle.categorySlug).toBe('gaming');
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

  it('does not promote desktop articles under explicit Laptops category when content lacks laptop evidence', () => {
    const desktopArticle = inferContentClusterContext({
      title: 'Alienware Aurora R16 Review',
      excerpt: '',
      category: 'Laptops',
      tags: ['alienware'],
      keywords: ['review'],
    });
    expect(desktopArticle.categorySlug).toBe('laptops');
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
      ['Best Gaming Laptop Stand 2026', 'Gaming Laptops', 'laptops'],
      ['Best Gaming Laptop Cooling Pads in Nigeria', 'Gaming', 'gaming'],
      ['Gaming Laptop Stands Buying Guide', 'Gaming Laptops', 'laptops'],
      ['Gaming Laptop GPU Upgrade Guide', 'Gaming', 'gaming'],
      ['Gaming Laptop Graphics Card Guide', 'Gaming', 'gaming'],
      ['Essential Accessories Buyer Guide 2026', 'Gaming Laptops', 'laptops'],
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

  it('excludes desktop and keyboard subjects in fallback scoring for unmapped categories', () => {
    const desktop = inferContentClusterContext({
      title: 'Alienware Aurora R16 Desktop Buyer Guide',
      excerpt: 'Prebuilt tower performance and Nigerian pricing.',
      category: 'Hardware Reviews',
      tags: ['alienware', 'desktop'],
      keywords: ['aurora', 'desktop'],
    });
    expect(desktop.categorySlug).toBe('desktops');

    const keyboard = inferContentClusterContext({
      title: 'Katana Mechanical Gaming Keyboard Review',
      excerpt: 'Tactile switches and RGB lighting.',
      category: 'Hardware Reviews',
      tags: ['katana', 'keyboard'],
      keywords: ['mechanical keyboard'],
    });
    expect(keyboard.categorySlug).not.toBe('gaming-laptops');
  });

  it('preserves legitimate gaming-laptop guides with GPU, desktop-class, pairing, or incidental excerpt tokens', () => {
    for (const [title, excerpt, kw] of [
      ['Best Gaming Laptops with RTX 4060 GPUs in Nigeria', 'Guide.', 'gpu'],
      [
        'Best Gaming Laptops for Desktop Replacement',
        'Guide.',
        'desktop replacement',
      ],
      ['Alienware m16 Desktop-Class Review', 'Guide.', 'desktop-class'],
      ['Best Gaming Laptops and Monitor Pairings', 'Guide.', 'monitors'],
      ['Top 10 Gaming Laptops with Free Accessories', 'Guide.', 'accessories'],
      [
        'Alienware m16 Gaming Laptop Buyer Guide',
        'Review covers display, keyboard, battery life.',
        'laptops',
      ],
      [
        'Best Gaming Laptops in Nigeria',
        'We compared keyboards, GPUs and battery life.',
        'gaming',
      ],
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
