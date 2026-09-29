import { preconnect, prefetchDNS, preload } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL } from '@/config/ogabassey';
import { OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST } from '@/config/ogabassey-home-hero-snapshot-manifest';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
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

// Minimal CDN projection twin: the snapshot branches never reach it, but the
// rotation-guard fallthrough cases must still emit a valid CDN hint.
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

const FLAG = 'NEXT_PUBLIC_OGABASSEY_HOME_HERO_SAME_ORIGIN_ENABLED';
const CDN_ORIGIN = 'https://cdn.ogabassey.com';
const ROTATED_HERO = `${CDN_ORIGIN}/core-assets/products/new-arrival.avif`;

// The real seeded manifest entry for the committed slide-0 URL.
const COMMITTED_ENTRY =
  OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST[OGABASSEY_TEMPLATE_ID][
    OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL
  ];

function renderLink(src: string | null | undefined): HTMLLinkElement | null {
  const html = renderToStaticMarkup(<OgabasseyHomeHeroPreloadLink src={src} />);
  if (!html) {
    return null;
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.querySelector('link');
}

describe('OgabasseyHomeHeroPreloadLink snapshot', () => {
  beforeEach(() => {
    process.env[FLAG] = 'true';
  });

  afterEach(() => {
    delete process.env[FLAG];
  });

  it('emits the same-origin snapshot for a manifest-covered URL', () => {
    const link = renderLink(OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL);

    expect(link?.getAttribute('rel')).toBe('preload');
    expect(link?.getAttribute('as')).toBe('image');
    expect(link?.getAttribute('fetchpriority')).toBe('high');
    expect(link?.getAttribute('media')).toBe('(max-width: 767px)');
    expect(link?.getAttribute('type')).toBe('image/avif');
    expect(link?.getAttribute('href')).toBe(COMMITTED_ENTRY.href);
    expect(link?.getAttribute('imagesrcset')).toBe(COMMITTED_ENTRY.srcSet);
    expect(link?.getAttribute('imagesizes')).toContain('40vw');
    expect(link?.getAttribute('data-ogabassey-home-hero-preload')).toBe('true');
  });

  it('falls through to the CDN hint when the slide rotated', () => {
    const link = renderLink(ROTATED_HERO);

    expect(link?.getAttribute('href')).toContain(CDN_ORIGIN);
    expect(link?.getAttribute('imagesrcset')).not.toContain('/_hero/');
  });

  it('falls through to the CDN hint when the flag is off', () => {
    delete process.env[FLAG];
    const link = renderLink(OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL);

    expect(link?.getAttribute('href')).toContain(CDN_ORIGIN);
    expect(link?.getAttribute('imagesrcset')).not.toContain('/_hero/');
  });
});

describe('preloadOgabasseyHomeHeroResources snapshot', () => {
  beforeEach(() => {
    process.env[FLAG] = 'true';
    vi.mocked(preload).mockClear();
    vi.mocked(preconnect).mockClear();
    vi.mocked(prefetchDNS).mockClear();
  });

  afterEach(() => {
    delete process.env[FLAG];
  });

  it('preloads the snapshot while keeping CDN origin hints', () => {
    preloadOgabasseyHomeHeroResources(OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL);

    expect(preload).toHaveBeenCalledTimes(1);
    const [href, options] = vi.mocked(preload).mock.calls[0];
    expect(href).toBe(COMMITTED_ENTRY.href);
    expect(options?.imageSrcSet).toBe(COMMITTED_ENTRY.srcSet);
    expect(options?.type).toBe('image/avif');
    expect(options?.media).toBe('(max-width: 767px)');
    // Slides past the first still load from the CDN.
    expect(prefetchDNS).toHaveBeenCalledWith(CDN_ORIGIN);
    expect(preconnect).toHaveBeenCalledWith(CDN_ORIGIN);
  });

  it('matches the rendered link exactly (one deduped fetch)', () => {
    const link = renderLink(OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL);
    preloadOgabasseyHomeHeroResources(OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL);

    const [href, options] = vi.mocked(preload).mock.calls[0];
    expect(link?.getAttribute('href')).toBe(String(href));
    expect(link?.getAttribute('imagesrcset')).toBe(options?.imageSrcSet);
    expect(link?.getAttribute('imagesizes')).toBe(options?.imageSizes);
    expect(link?.getAttribute('media')).toBe(options?.media);
    expect(link?.getAttribute('type')).toBe(options?.type ?? null);
  });

  it('falls through to the CDN hint when the slide rotated', () => {
    preloadOgabasseyHomeHeroResources(ROTATED_HERO);

    expect(preload).toHaveBeenCalledTimes(1);
    const [href, options] = vi.mocked(preload).mock.calls[0];
    expect(String(href)).toContain(CDN_ORIGIN);
    expect(options?.imageSrcSet).not.toContain('/_hero/');
  });

  it('falls through to the CDN hint when the flag is off', () => {
    delete process.env[FLAG];
    preloadOgabasseyHomeHeroResources(OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL);

    expect(preload).toHaveBeenCalledTimes(1);
    const [href, options] = vi.mocked(preload).mock.calls[0];
    expect(String(href)).toContain(CDN_ORIGIN);
    expect(options?.imageSrcSet).not.toContain('/_hero/');
  });
});
