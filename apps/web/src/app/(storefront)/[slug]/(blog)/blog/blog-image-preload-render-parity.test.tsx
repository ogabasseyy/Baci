// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BLOG_HERO_IMAGE_QUALITY,
  BLOG_LISTING_FEATURED_IMAGE_SIZES,
  BLOG_POST_HERO_IMAGE_SIZES,
} from '@/components/storefront/ogabassey/config/blog-media';

vi.mock('server-only', () => ({}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Restore the REAL next/image getImageProps (the global vitest.setup mocks
// next/image with only a `default` export) so both the rendered <picture> and
// the preload hint build their srcSets through the identical production path.
vi.mock('next/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/image')>();
  return { ...actual };
});

const preloadMock = vi.hoisted(() => vi.fn());

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return {
    ...actual,
    preconnect: vi.fn(),
    prefetchDNS: vi.fn(),
    preload: preloadMock,
  };
});

import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import { preloadOgabasseyBlogPostHeroResources } from './[postSlug]/blog-post-hero-resource-hints';
import { preloadBlogListingFeaturedImage } from './blog-listing-featured-image-preload';
import { BlogListingOgabasseyLcpHero } from './blog-listing-ogabassey-lcp-hero';

const CDN_BLOG_IMAGE =
  'https://cdn.ogabassey.com/core-assets/blog/post/hero.jpg';

/** Case-insensitive extraction of the AVIF `<source>`'s srcset from markup. */
function extractAvifSourceSrcSet(markup: string): string {
  const match = markup.match(
    /<source[^>]*type="image\/avif"[^>]*\ssrcset="([^"]*)"/i
  );
  // React may serialize the attributes in either order — try the reverse too.
  if (match?.[1]) {
    return match[1];
  }
  const reverse = markup.match(
    /<source[^>]*\ssrcset="([^"]*)"[^>]*type="image\/avif"/i
  );
  return reverse?.[1] ?? '';
}

function getPreloadedAvifSrcSet(): { srcSet: string; type?: string } {
  expect(preloadMock).toHaveBeenCalledTimes(1);
  const [, options] = preloadMock.mock.calls[0] as [
    string,
    { imageSrcSet?: string; type?: string },
  ];
  return { srcSet: options.imageSrcSet ?? '', type: options.type };
}

function expectNoPoisonableFormats(...srcSets: string[]): void {
  for (const srcSet of srcSets) {
    expect(srcSet).not.toContain('format=auto');
    expect(srcSet).not.toContain('format=jpeg');
    expect(srcSet).not.toContain('format=png');
  }
}

describe('OgaBassey blog image preload-vs-render parity', () => {
  beforeEach(() => {
    preloadMock.mockClear();
  });

  it('featured story renders and preloads a byte-identical AVIF srcSet', () => {
    // RENDER side: what the listing featured-story <picture> paints for AVIF.
    const markup = renderToStaticMarkup(
      <CdnFormatImage
        alt=""
        fill
        quality={BLOG_HERO_IMAGE_QUALITY}
        sizes={BLOG_LISTING_FEATURED_IMAGE_SIZES}
        src={CDN_BLOG_IMAGE}
      />
    );
    const renderedAvifSrcSet = extractAvifSourceSrcSet(markup);

    // PRELOAD side: the resource hint the listing shell emits for the same image.
    preloadBlogListingFeaturedImage(CDN_BLOG_IMAGE);
    const { srcSet: preloadedAvifSrcSet, type } = getPreloadedAvifSrcSet();

    expect(renderedAvifSrcSet).not.toBe('');
    expect(renderedAvifSrcSet).toContain('format=avif');
    expect(type).toBe('image/avif');
    expect(preloadedAvifSrcSet).toBe(renderedAvifSrcSet);
    expectNoPoisonableFormats(renderedAvifSrcSet, preloadedAvifSrcSet);
  });

  it('blog post hero renders and preloads a byte-identical AVIF srcSet', () => {
    // RENDER side: what the blog post hero <picture> paints for AVIF. Rendered
    // without the `preload` prop so only the resource-hint module's preload is
    // captured — the <source> srcSet is independent of the preload hint.
    const markup = renderToStaticMarkup(
      <CdnFormatImage
        alt=""
        fill
        quality={BLOG_HERO_IMAGE_QUALITY}
        sizes={BLOG_POST_HERO_IMAGE_SIZES}
        src={CDN_BLOG_IMAGE}
      />
    );
    const renderedAvifSrcSet = extractAvifSourceSrcSet(markup);

    // PRELOAD side: the resource hint the static blog-post shell emits.
    preloadOgabasseyBlogPostHeroResources(CDN_BLOG_IMAGE);
    const { srcSet: preloadedAvifSrcSet, type } = getPreloadedAvifSrcSet();

    expect(renderedAvifSrcSet).not.toBe('');
    expect(renderedAvifSrcSet).toContain('format=avif');
    expect(type).toBe('image/avif');
    expect(preloadedAvifSrcSet).toBe(renderedAvifSrcSet);
    expectNoPoisonableFormats(renderedAvifSrcSet, preloadedAvifSrcSet);
  });

  it('committed LCP hero component renders and preloads a byte-identical AVIF srcSet in initial HTML', () => {
    const markup = renderToStaticMarkup(<BlogListingOgabasseyLcpHero />);
    const renderedAvifSrcSet = extractAvifSourceSrcSet(markup);
    const { srcSet: preloadedAvifSrcSet, type } = getPreloadedAvifSrcSet();

    expect(renderedAvifSrcSet).not.toBe('');
    expect(renderedAvifSrcSet).toContain('format=avif');
    expect(type).toBe('image/avif');
    expect(preloadedAvifSrcSet).toBe(renderedAvifSrcSet);
    expectNoPoisonableFormats(renderedAvifSrcSet, preloadedAvifSrcSet);
  });
});
