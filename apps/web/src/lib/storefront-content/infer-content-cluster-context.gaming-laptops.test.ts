import { describe, expect, it } from 'vitest';
import { inferContentClusterContext } from './infer-content-cluster-context';

describe('inferContentClusterContext - gaming laptops', () => {
  it('infers gaming-laptops categorySlug for gaming laptop articles even when category is generic Gaming', () => {
    const hpOmen = inferContentClusterContext({
      title: 'HP Omen 16 (2026): Price in Nigeria, Specs & Where to Buy',
      excerpt: null,
      category: 'Gaming',
      tags: ['gaming', 'hp omen 16', 'gaming laptop'],
      keywords: ['buyer guide'],
    });
    expect(hpOmen.categorySlug).toBe('gaming-laptops');

    const gamingLaptopsComparison = inferContentClusterContext({
      title:
        'Gaming Laptops in Nigeria (2026): Alienware vs ROG vs Legion vs Omen',
      excerpt: null,
      category: 'Gaming',
      tags: ['gaming', 'alienware', 'rog', 'legion', 'omen'],
      keywords: ['buyer guide'],
    });
    expect(gamingLaptopsComparison.categorySlug).toBe('gaming-laptops');
  });

  it('promotes Laptops category posts to gaming-laptops when title specifically covers gaming laptops', () => {
    const gamingLaptopRoundup = inferContentClusterContext({
      title: 'Best Gaming Laptops in Nigeria (2026)',
      excerpt: 'Top portable gaming rigs for Nigerian gamers.',
      category: 'Laptops',
      tags: ['laptops', 'budget'],
      keywords: ['buyer guide'],
    });
    expect(gamingLaptopRoundup.categorySlug).toBe('gaming-laptops');

    const asusRogReview = inferContentClusterContext({
      title: 'ASUS ROG RTX 4060 Laptop Review and Price in Nigeria',
      excerpt: 'High refresh rate portable powerhouse reviewed.',
      category: 'Laptops',
      tags: ['laptops', 'asus'],
      keywords: ['buyer guide'],
    });
    expect(asusRogReview.categorySlug).toBe('gaming-laptops');
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
      title: 'Best Student Laptops in Nigeria: 2026 Edition',
      excerpt:
        'Comparing lightweight notebooks for school against heavier Legion and Omen options.',
      category: 'Laptops',
      tags: ['laptops', 'students', 'legion', 'omen'],
      keywords: ['buyer guide', 'school'],
    });
    expect(studentLaptopGuide.categorySlug).toBe('laptops');
  });

  it('keeps Gaming and Laptops categories for monitor articles even when title mentions gaming laptop setup', () => {
    const gamingMonitorSetup = inferContentClusterContext({
      title: 'Best Monitors for a Gaming Laptop Setup',
      excerpt: 'Top external displays to pair with your mobile gaming rig.',
      category: 'Gaming',
      tags: ['gaming', 'monitors', 'gaming laptop'],
      keywords: ['buyer guide'],
    });
    expect(gamingMonitorSetup.categorySlug).toBe('gaming');

    const laptopMonitorSetup = inferContentClusterContext({
      title: 'Top 5 Monitors for Your Gaming Laptop in 2026',
      excerpt: 'High refresh rate external monitors for laptop gamers.',
      category: 'Laptops',
      tags: ['laptops', 'monitors', 'gaming laptop'],
      keywords: ['buyer guide'],
    });
    expect(laptopMonitorSetup.categorySlug).toBe('laptops');
  });

  it('keeps Gaming and Laptops categories for desktop and GPU articles with dedicated gaming tokens and laptop metadata', () => {
    const alienwareDesktop = inferContentClusterContext({
      title: 'Alienware Aurora R16 Gaming Desktop Review',
      excerpt: 'A prebuilt powerhouse with liquid cooling and RTX graphics.',
      category: 'Laptops',
      tags: ['laptops', 'alienware', 'gaming', 'desktop'],
      keywords: ['buyer guide'],
    });
    expect(alienwareDesktop.categorySlug).toBe('laptops');

    const rtxGpuGuide = inferContentClusterContext({
      title: 'Nvidia RTX 5080 GPU Guide and Benchmark',
      excerpt:
        'Desktop graphics card performance comparison and Nigerian pricing.',
      category: 'Gaming',
      tags: ['gaming', 'rtx', 'laptop'],
      keywords: ['buyer guide'],
    });
    expect(rtxGpuGuide.categorySlug).toBe('gaming');

    const geforceGraphicsCard = inferContentClusterContext({
      title: 'GeForce RTX 4080 Graphics Card Buyer Guide',
      excerpt: 'Discrete graphics card buying advice for PC builders.',
      category: 'Gaming',
      tags: ['gaming', 'geforce', 'rtx', 'laptop'],
      keywords: ['buyer guide'],
    });
    expect(geforceGraphicsCard.categorySlug).toBe('gaming');
  });

  it('keeps Gaming and Laptops categories for accessory articles mentioning gaming laptops without promoting to gaming-laptops', () => {
    const accessoriesGuide = inferContentClusterContext({
      title: 'Best Gaming Laptop Accessories in Nigeria',
      excerpt: 'Must-have peripherals and gear for your mobile gaming setup.',
      category: 'Gaming',
      tags: ['gaming', 'accessories', 'gaming laptop'],
      keywords: ['buyer guide'],
    });
    expect(accessoriesGuide.categorySlug).toBe('gaming');

    const coolingPadReview = inferContentClusterContext({
      title: 'Gaming Laptop Cooling Pad Review and Temperature Benchmarks',
      excerpt: 'Testing the best cooling pads for high-performance laptops.',
      category: 'Laptops',
      tags: ['laptops', 'cooling pad', 'gaming laptop'],
      keywords: ['review'],
    });
    expect(coolingPadReview.categorySlug).toBe('laptops');

    const laptopStandGuide = inferContentClusterContext({
      title: 'Ergonomic Gaming Laptop Stand Buying Guide',
      excerpt:
        'Elevate your gaming laptop display for better thermals and posture.',
      category: 'Gaming',
      tags: ['gaming', 'stand', 'gaming laptop'],
      keywords: ['buyer guide'],
    });
    expect(laptopStandGuide.categorySlug).toBe('gaming');
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
    const predatorGuide = inferContentClusterContext({
      title: 'Acer Predator Helios 16 Buyer Guide',
      excerpt: 'Comprehensive buyer guide for mobile gamers.',
      category: 'Gaming',
      tags: ['gaming', 'laptop'],
      keywords: ['buyer guide'],
    });
    expect(predatorGuide.categorySlug).toBe('gaming-laptops');

    const aorusGuide = inferContentClusterContext({
      title: 'Gigabyte Aorus 16X Buyer Guide',
      excerpt: 'Testing thermals and frame rates on Aorus 16X.',
      category: 'Gaming',
      tags: ['gaming', 'laptop'],
      keywords: ['buyer guide'],
    });
    expect(aorusGuide.categorySlug).toBe('gaming-laptops');

    const bladeGuide = inferContentClusterContext({
      title: 'Razer Blade 16 Laptop Review',
      excerpt: 'Premium thin and light gaming laptop benchmarks.',
      category: 'Laptops',
      tags: ['laptops', 'razer'],
      keywords: ['review'],
    });
    expect(bladeGuide.categorySlug).toBe('gaming-laptops');

    const nitroGuide = inferContentClusterContext({
      title: 'Acer Nitro 15 Laptop Review',
      excerpt: 'Budget-friendly mobile gaming performance tested.',
      category: 'Laptops',
      tags: ['laptops', 'acer'],
      keywords: ['review'],
    });
    expect(nitroGuide.categorySlug).toBe('gaming-laptops');

    const katanaGuide = inferContentClusterContext({
      title: 'MSI Katana 15 Laptop Review',
      excerpt: 'Entry gaming laptop review with RTX graphics.',
      category: 'Laptops',
      tags: ['laptops', 'msi'],
      keywords: ['review'],
    });
    expect(katanaGuide.categorySlug).toBe('gaming-laptops');
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
    const desktopArticle = inferContentClusterContext({
      title: 'Alienware Aurora R16 Review',
      excerpt: 'High-performance gaming desktop benchmarked.',
      category: 'Gaming',
      tags: ['gaming laptop', 'alienware', 'gaming'],
      keywords: ['review'],
    });
    expect(desktopArticle.categorySlug).toBe('gaming');
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

  it('does not classify gaming laptop accessories or stands as gaming-laptops', () => {
    const accessoryArticle = inferContentClusterContext({
      title: 'Top 5 Ergonomic Laptop Stands to Buy in 2026',
      excerpt: 'Stands for your gaming laptop workstation.',
      category: 'Gaming Laptop Accessories',
      tags: ['stands', 'accessories'],
      keywords: ['stand'],
    });
    expect(accessoryArticle.categorySlug).not.toBe('gaming-laptops');

    const standArticle = inferContentClusterContext({
      title: 'Best Gaming Laptop Stand 2026',
      excerpt: 'Keep your machine cool.',
      category: 'Gaming Laptops',
      tags: ['stands'],
      keywords: ['stand'],
    });
    expect(standArticle.categorySlug).toBe('laptops');
  });
});
