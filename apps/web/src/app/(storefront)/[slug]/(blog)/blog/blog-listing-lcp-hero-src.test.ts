import { describe, expect, it } from 'vitest';
import { buildBlogListingLcpHeroSrc } from './blog-listing-lcp-hero-src';

const RAW =
  'https://cdn.ogabassey.com/core-assets/blog/codex/hero/post-landscape_16x9.jpg';

describe('buildBlogListingLcpHeroSrc', () => {
  it('rewrites a raw CDN JPEG to the listing preload AVIF transform', () => {
    expect(buildBlogListingLcpHeroSrc(RAW)).toBe(
      'https://cdn.ogabassey.com/image/width=750,quality=50,format=avif/core-assets/blog/codex/hero/post-landscape_16x9.jpg'
    );
  });

  it('does not leave the untransformed public JPEG that 404s on CDN', () => {
    const src = buildBlogListingLcpHeroSrc(RAW);

    expect(src).not.toBe(RAW);
    expect(src).toContain('/image/width=750,quality=50,format=avif/');
  });

  it('passes through non-CDN URLs so an external snapshot still renders', () => {
    expect(buildBlogListingLcpHeroSrc('https://cdn.example.com/hero.png')).toBe(
      'https://cdn.example.com/hero.png'
    );
  });
});
