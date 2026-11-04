import { describe, expect, it } from 'vitest';
import { inferContentClusterContext } from './infer-content-cluster-context';

describe('inferContentClusterContext - gaming laptops promotion & demotion', () => {
  it('does not demote explicit Gaming Laptops post due to incidental excerpt subjects', () => {
    const post = inferContentClusterContext({
      title: 'Alienware m16 Review',
      excerpt:
        'Tested with a cooling pad and an external monitor for 24 hours.',
      category: 'Gaming Laptops',
      tags: ['alienware', 'gaming'],
      keywords: ['review'],
    });
    expect(post.categorySlug).toBe('gaming-laptops');
  });

  it('demotes explicit Gaming Laptops post when title establishes excluded subject', () => {
    const desktopPost = inferContentClusterContext({
      title: 'Alienware Aurora R16 Gaming Desktop Review',
      excerpt: 'Flagship prebuilt tower gaming performance.',
      category: 'Gaming Laptops',
      tags: ['alienware', 'gaming'],
      keywords: ['desktop'],
    });
    expect(desktopPost.categorySlug).toBe('desktops');

    const accessoryPost = inferContentClusterContext({
      title: 'Top 5 Ergonomic Cooling Pads for High-End Setups',
      excerpt: 'Great pads to keep temperatures low.',
      category: 'Gaming Laptops',
      tags: ['cooling', 'pads'],
      keywords: ['accessories'],
    });
    expect(accessoryPost.categorySlug).toBe('accessories');
  });

  it('rejects ambiguous game titles from explicit Laptops promotion', () => {
    const gamePost = inferContentClusterContext({
      title: 'Blade Vampire Action Game Review',
      excerpt: 'Exciting gothic combat and vampire hunter lore.',
      category: 'Laptops',
      tags: ['blade', 'laptop', 'gaming'],
      keywords: ['game', 'action'],
    });
    expect(gamePost.categorySlug).toBe('laptops');
  });

  it('requires positive laptop evidence in title or excerpt for explicit Gaming promotion', () => {
    const gpuPost = inferContentClusterContext({
      title: 'RTX 5080 Review: Next-Gen Graphics Tested',
      excerpt: 'Benchmarked across modern ray-traced titles.',
      category: 'Gaming',
      tags: ['laptop', 'rtx', 'graphics'],
      keywords: ['review', 'gpu'],
    });
    expect(gpuPost.categorySlug).toBe('gaming');
  });

  it('promotes titles with RGB keyboards to gaming-laptops when subject is laptops', () => {
    const keyboardLaptop = inferContentClusterContext({
      title: 'Best Gaming Laptops with RGB Keyboards',
      excerpt:
        'Premium machines featuring mechanical switches and per-key lighting.',
      category: 'Gaming',
      tags: ['gaming', 'laptops', 'rgb'],
      keywords: ['keyboards'],
    });
    expect(keyboardLaptop.categorySlug).toBe('gaming-laptops');
  });

  it('does not promote gaming keyboard accessories to gaming-laptops', () => {
    const keyboardAccessory = inferContentClusterContext({
      title: 'Razer Huntsman Gaming Keyboard Review',
      excerpt: 'Optical switches and clicky actuation tested for esports.',
      category: 'Gaming',
      tags: ['razer', 'keyboard', 'gaming'],
      keywords: ['review'],
    });
    expect(keyboardAccessory.categorySlug).not.toBe('gaming-laptops');
  });

  it('promotes legitimate Razer Blade post from Laptops when positive evidence exists', () => {
    const bladeLaptop = inferContentClusterContext({
      title: 'Razer Blade 16 Review: Mobile Powerhouse',
      excerpt: 'Thin and light gaming laptop benchmarked.',
      category: 'Laptops',
      tags: ['razer', 'blade'],
      keywords: ['laptop'],
    });
    expect(bladeLaptop.categorySlug).toBe('gaming-laptops');
  });

  it('excludes plural GPU subjects from laptop promotion under Gaming', () => {
    for (const title of [
      'Gaming Laptop GPU Upgrade Buyer Guide',
      'Gaming Laptop GPUs Upgrade Buyer Guide',
      'Gaming Laptop Graphics Card Guide',
      'Gaming Laptop Graphics Cards Guide',
    ]) {
      const gpuPost = inferContentClusterContext({
        title,
        excerpt: 'Component upgrades and benchmarks for mobile chips.',
        category: 'Gaming',
        tags: ['gpu', 'gaming'],
        keywords: ['upgrade'],
      });
      expect(gpuPost.categorySlug).toBe('gaming');
    }
  });

  it('promotes MSI dedicated gaming laptop lines (raider, stealth, titan, vector, crosshair)', () => {
    for (const [title, category] of [
      ['MSI Raider GE78 Laptop Review', 'Laptops'],
      ['MSI Stealth 16 Studio Laptop Review', 'Gaming'],
      ['MSI Titan 18 HX Laptop Review', 'Laptops'],
      ['MSI Vector 16 GP78 Laptop Review', 'Gaming'],
      ['MSI Crosshair 17 Laptop Review', 'Laptops'],
    ] as const) {
      const guide = inferContentClusterContext({
        title,
        excerpt: 'High-performance mobile hardware tested.',
        category,
        tags: ['msi', 'gaming', 'laptop'],
        keywords: ['review'],
      });
      expect(guide.categorySlug).toBe('gaming-laptops');
    }
  });

  it('does not attribute razer or acer brand to ambiguous family titles lacking parent brand', () => {
    const post = inferContentClusterContext({
      title: 'Blade Vampire Action Game Review',
      excerpt: 'Exciting gothic combat and vampire hunter lore.',
      category: 'Laptops',
      tags: ['blade', 'predator', 'nitro', 'action'],
      keywords: ['review'],
    });
    expect(post.brands).not.toContain('razer');
    expect(post.brands).not.toContain('acer');
  });

  it('handles hyphenated gaming-laptop phrases, monitor-led pairings, for-gaming-laptop GPUs, explicit accessory categories, and game-title excerpts', () => {
    expect(
      inferContentClusterContext({
        title: 'Best Gaming-Laptop Deals in Nigeria',
        excerpt: null,
        category: 'Gaming',
        tags: [],
        keywords: [],
      }).categorySlug
    ).toBe('gaming-laptops');

    expect(
      inferContentClusterContext({
        title: 'Best Monitor Pairings for Gaming Laptops',
        excerpt: 'External displays.',
        category: 'Gaming',
        tags: [],
        keywords: [],
      }).categorySlug
    ).not.toBe('gaming-laptops');

    expect(
      inferContentClusterContext({
        title: 'Best GPUs for Gaming Laptops',
        excerpt: 'Mobile graphics.',
        category: 'Gaming',
        tags: [],
        keywords: [],
      }).categorySlug
    ).toBe('gaming');

    expect(
      inferContentClusterContext({
        title: 'Gaming-Laptop GPU Upgrade Buyer Guide',
        excerpt: 'Mobile graphics.',
        category: 'Gaming',
        tags: [],
        keywords: [],
      }).categorySlug
    ).toBe('gaming');

    expect(
      inferContentClusterContext({
        title: 'Stealth Travel Laptop Review',
        excerpt: 'Ultrabook for flights.',
        category: 'Laptops',
        tags: [],
        keywords: [],
      }).categorySlug
    ).toBe('laptops');

    expect(
      inferContentClusterContext({
        title: 'Titan Workstation Laptop Review',
        excerpt: 'CAD workstation.',
        category: 'Laptops',
        tags: [],
        keywords: [],
      }).categorySlug
    ).toBe('laptops');

    expect(
      inferContentClusterContext({
        title: 'Top Picks for Your Setup',
        excerpt: 'Mechanical switches.',
        category: 'Gaming Laptop Keyboard',
        tags: [],
        keywords: [],
      }).categorySlug
    ).toBe('accessories');

    expect(
      inferContentClusterContext({
        title: 'Blade Predator Game Review',
        excerpt: 'Playable on laptops.',
        category: 'Hardware Reviews',
        tags: ['blade', 'predator'],
        keywords: [],
      }).categorySlug
    ).not.toBe('gaming-laptops');
  });
});
