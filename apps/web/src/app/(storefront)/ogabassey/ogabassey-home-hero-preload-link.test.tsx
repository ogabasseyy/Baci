import { preload } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ogabasseyHomeHeroResourceHintProjection } from '@/lib/ogabassey-home-hero-resource-hint-projection';
import { OgabasseyHomeHeroPreloadLink } from './ogabassey-home-hero-preload-link';
import { preloadOgabasseyHomeHeroResources } from './ogabassey-home-hero-resource-hints';

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return {
    ...actual,
    preconnect: vi.fn(),
    prefetchDNS: vi.fn(),
    preload: vi.fn((...args: Parameters<typeof actual.preload>) =>
      actual.preload(...args)
    ),
  };
});

// Mirror what the real loader emits (an explicit-format `/image/…` transform
// URL) so the AVIF-rewrite branch is exercised.
vi.mock('next/image', () => ({
  getImageProps: vi.fn(
    ({
      sizes,
      src,
      loader,
      quality,
    }: {
      sizes?: string;
      src: string;
      loader?: (input: {
        src: string;
        width: number;
        quality?: number;
      }) => string;
      quality?: number;
    }) => {
      const candidate = (width: number) =>
        loader ? loader({ src, width, quality }) : `${src}?w=${width}`;
      return {
        props: {
          sizes,
          srcSet: `${candidate(750)} 750w, ${candidate(1440)} 1440w`,
        },
      };
    }
  ),
}));

const CDN_ORIGIN = 'https://cdn.ogabassey.com';
const CDN_HERO = `${CDN_ORIGIN}/core-assets/products/tecno-spark-40-pro.avif`;

function renderLinks(src: string | null | undefined): HTMLLinkElement[] {
  const html = renderToStaticMarkup(<OgabasseyHomeHeroPreloadLink src={src} />);
  if (!html) {
    return [];
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  return Array.from(
    template.content.querySelectorAll('link[rel="preload"][as="image"]')
  );
}

describe('OgabasseyHomeHeroPreloadLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits a single mobile-scoped responsive preload for the slide-0 hero', () => {
    const links = renderLinks(CDN_HERO);

    expect(links).toHaveLength(1);
    const [link] = links;
    expect(link?.getAttribute('rel')).toBe('preload');
    expect(link?.getAttribute('as')).toBe('image');
    expect(link?.getAttribute('fetchpriority')).toBe('high');
    expect(link?.getAttribute('media')).toBe('(max-width: 767px)');
    expect(link?.getAttribute('type')).toBe('image/avif');
    expect(link?.getAttribute('imagesrcset')).toContain('format=avif');
    expect(link?.getAttribute('imagesrcset')).toContain('750w');
    expect(link?.getAttribute('imagesrcset')).not.toContain('1440w');
    expect(link?.getAttribute('imagesizes')).toContain('40vw');
  });

  it('matches the react-dom preload hint and shared projection (single source of truth)', () => {
    const [link] = renderLinks(CDN_HERO);
    const projection = ogabasseyHomeHeroResourceHintProjection.build(CDN_HERO);

    expect(preload).toHaveBeenCalledTimes(1);
    const [href, options] = vi.mocked(preload).mock.calls[0];
    expect(projection).not.toBeNull();
    expect(String(href)).toBe(projection?.href);
    expect(link?.getAttribute('imagesrcset')).toBe(options?.imageSrcSet);
    expect(link?.getAttribute('imagesrcset')).toBe(projection?.imageSrcSet);
    expect(link?.getAttribute('imagesizes')).toBe(options?.imageSizes);
    expect(link?.getAttribute('media')).toBe(options?.media);
    expect(link?.getAttribute('type')).toBe(options?.type ?? null);

    preloadOgabasseyHomeHeroResources(CDN_HERO);
    expect(preload).toHaveBeenCalledTimes(2);
  });

  it('renders nothing for non-CDN, blank, or missing sources', () => {
    expect(renderLinks('https://example.com/hero.jpg')).toHaveLength(0);
    expect(renderLinks('   ')).toHaveLength(0);
    expect(renderLinks(null)).toHaveLength(0);
    expect(renderLinks(undefined)).toHaveLength(0);
  });
});
