import { preload } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ogabasseyHomeHeroResourceHintProjection } from '@/lib/ogabassey-home-hero-resource-hint-projection';
import { OgabasseyHomeHeroPreloadLink } from './ogabassey-home-hero-preload-link';
import { preloadOgabasseyHomeHeroResources } from './ogabassey-home-hero-resource-hints';

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return {
    ...actual,
    preconnect: vi.fn(),
    prefetchDNS: vi.fn(),
    preload: vi.fn(),
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

function renderLink(src: string | null | undefined): HTMLLinkElement | null {
  const html = renderToStaticMarkup(<OgabasseyHomeHeroPreloadLink src={src} />);
  if (!html) {
    return null;
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.querySelector('link');
}

describe('OgabasseyHomeHeroPreloadLink', () => {
  it('renders a mobile-scoped responsive preload for the slide-0 hero', () => {
    const link = renderLink(CDN_HERO);

    expect(link?.getAttribute('rel')).toBe('preload');
    expect(link?.getAttribute('as')).toBe('image');
    expect(link?.getAttribute('fetchpriority')).toBe('high');
    expect(link?.getAttribute('media')).toBe('(max-width: 767px)');
    expect(link?.getAttribute('type')).toBe('image/avif');
    expect(link?.getAttribute('href')).toContain('format=avif');
    expect(link?.getAttribute('imagesrcset')).toContain('format=avif');
    expect(link?.getAttribute('imagesizes')).toContain('40vw');
    expect(link?.getAttribute('data-ogabassey-home-hero-preload')).toBe('true');
  });

  it('matches the react-dom preload hint exactly (one deduped fetch)', () => {
    const link = renderLink(CDN_HERO);
    preloadOgabasseyHomeHeroResources(CDN_HERO);

    expect(preload).toHaveBeenCalledTimes(1);
    const [href, options] = vi.mocked(preload).mock.calls[0];
    expect(link?.getAttribute('href')).toBe(String(href));
    expect(link?.getAttribute('imagesrcset')).toBe(options?.imageSrcSet);
    expect(link?.getAttribute('imagesizes')).toBe(options?.imageSizes);
    expect(link?.getAttribute('media')).toBe(options?.media);
    expect(link?.getAttribute('type')).toBe(options?.type ?? null);
  });

  it('matches the shared projection (single source of truth)', () => {
    const link = renderLink(CDN_HERO);
    const projection = ogabasseyHomeHeroResourceHintProjection.build(CDN_HERO);

    expect(projection).not.toBeNull();
    expect(link?.getAttribute('href')).toBe(projection?.href);
  });

  it('renders nothing for non-CDN, blank, or missing sources', () => {
    expect(renderLink('https://example.com/hero.jpg')).toBeNull();
    expect(renderLink('   ')).toBeNull();
    expect(renderLink(null)).toBeNull();
    expect(renderLink(undefined)).toBeNull();
  });
});
