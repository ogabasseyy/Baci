import { preconnect, prefetchDNS, preload } from 'react-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOG_POST_HERO_IMAGE_SIZES } from '@/components/storefront/ogabassey/config/blog-media';
import { preloadOgabasseyBlogPostHeroResources } from './blog-post-hero-resource-hints';

vi.mock('server-only', () => ({}));

vi.mock('react-dom', () => ({
  preconnect: vi.fn(),
  prefetchDNS: vi.fn(),
  preload: vi.fn(),
}));

// Build the srcSet by calling the REAL shared loader the module passes in, so
// the mock produces genuine explicit-format CDN transform URLs (jpeg fallback
// tier) and `buildOgabasseyAvifSrcSet` can derive the AVIF `<source>` twin.
vi.mock('next/image', () => ({
  getImageProps: vi.fn(
    (props: {
      loader: (params: {
        quality?: number;
        src: string;
        width: number;
      }) => string;
      quality?: number;
      sizes?: string;
      src: string;
    }) => {
      const widths = [384, 640, 750, 828, 1080, 1200, 1440];
      return {
        props: {
          sizes: props.sizes,
          srcSet: widths
            .map(
              (width) =>
                `${props.loader({
                  quality: props.quality,
                  src: props.src,
                  width,
                })} ${width}w`
            )
            .join(', '),
        },
      };
    }
  ),
}));

const CDN_ORIGIN = 'https://cdn.ogabassey.com';
const CDN_HERO = `${CDN_ORIGIN}/core-assets/blog/post/hero.jpg`;

describe('preloadOgabasseyBlogPostHeroResources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preconnects the CDN and preloads the AVIF tier the blog post hero picture paints', () => {
    preloadOgabasseyBlogPostHeroResources(CDN_HERO);

    expect(prefetchDNS).toHaveBeenCalledWith(CDN_ORIGIN);
    expect(preconnect).toHaveBeenCalledWith(CDN_ORIGIN);
    // The href/srcSet must be the explicit `format=avif` twin the rendered
    // `<source type="image/avif">` requests — never the poisonable `format=auto`
    // body (Cloudflare Free ignores Vary: Accept). Quality stays 50 so the
    // preload and the lockstep <picture> resolve to the same transform.
    expect(preload).toHaveBeenCalledWith(
      'https://cdn.ogabassey.com/image/width=1200,quality=50,format=avif/core-assets/blog/post/hero.jpg',
      expect.objectContaining({
        as: 'image',
        fetchPriority: 'high',
        imageSizes: BLOG_POST_HERO_IMAGE_SIZES,
        imageSrcSet: expect.stringContaining(
          'https://cdn.ogabassey.com/image/width=1200,quality=50,format=avif/core-assets/blog/post/hero.jpg 1200w'
        ),
        type: 'image/avif',
      })
    );

    const options = vi.mocked(preload).mock.calls[0]?.[1];
    expect(options?.imageSrcSet).toContain('format=avif');
    expect(options?.imageSrcSet).not.toContain('format=auto');
    expect(options?.imageSrcSet).not.toContain('format=jpeg');
  });

  it('does nothing for non-OgaBassey-CDN heroes', () => {
    preloadOgabasseyBlogPostHeroResources('https://example.com/hero.jpg');

    expect(prefetchDNS).not.toHaveBeenCalled();
    expect(preconnect).not.toHaveBeenCalled();
    expect(preload).not.toHaveBeenCalled();
  });

  it('does nothing for empty or missing sources', () => {
    preloadOgabasseyBlogPostHeroResources('   ');
    preloadOgabasseyBlogPostHeroResources(null);
    preloadOgabasseyBlogPostHeroResources(undefined);

    expect(preload).not.toHaveBeenCalled();
  });
});
