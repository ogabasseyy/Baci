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
});
