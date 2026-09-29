import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OgabasseyHomeHeroSnapshot } from '@/lib/ogabassey-home-hero-snapshot-types';
import { TRANSPARENT_PIXEL_SRC } from './hero-mobile-image-config';
import { MobileLcpHeroImage } from './mobile-lcp-hero-image';

const HERO_MOBILE_LCP_SRC = 'https://cdn.ogabassey.com/products/a27.avif';
const ROTATED_SRC = 'https://cdn.ogabassey.com/products/new-arrival.avif';

const SNAPSHOT: OgabasseyHomeHeroSnapshot = {
  sourceUrl: HERO_MOBILE_LCP_SRC,
  srcSet:
    '/_hero/ogabassey/abc123-640.avif 640w, /_hero/ogabassey/abc123-960.avif 960w',
  href: '/_hero/ogabassey/abc123-960.avif',
};

const mockGetImageProps = vi.hoisted(() =>
  vi.fn(
    (props: Record<string, unknown>): { props: Record<string, unknown> } => {
      const loader = props.loader as
        | ((input: { src: string; width: number; quality?: number }) => string)
        | undefined;
      const src = String(props.src);
      const quality = Number(props.quality ?? 70);
      const candidate640 = loader
        ? loader({ src, width: 640, quality })
        : `${src}?w=640&q=${quality}`;
      const candidate960 = loader
        ? loader({ src, width: 960, quality })
        : `${src}?w=960&q=${quality}`;

      return {
        props: {
          alt: props.alt,
          decoding: props.decoding,
          fetchPriority: props.fetchPriority,
          height: props.height,
          loading: props.loading,
          sizes: props.sizes,
          src: candidate960,
          srcSet: `${candidate640} 640w, ${candidate960} 960w`,
          width: props.width,
        },
      };
    }
  )
);

vi.mock('next/image', () => ({
  getImageProps: mockGetImageProps,
}));

function mobileSources(container: HTMLElement) {
  return container.querySelectorAll('source[media="(max-width: 767px)"]');
}

describe('MobileLcpHeroImage snapshot', () => {
  beforeEach(() => {
    mockGetImageProps.mockClear();
  });

  it('swaps only the AVIF tier to the snapshot on an exact source match', () => {
    const { container } = render(
      <MobileLcpHeroImage
        alt="Samsung Galaxy A27 5G"
        imageFit="contain"
        shouldPrioritizeImage={true}
        snapshot={SNAPSHOT}
        src={HERO_MOBILE_LCP_SRC}
      />
    );

    const sources = mobileSources(container);
    expect(sources).toHaveLength(2);
    const [avifSource, fallbackSource] = sources;
    expect(avifSource).toHaveAttribute('type', 'image/avif');
    expect(avifSource?.getAttribute('srcset')).toBe(SNAPSHOT.srcSet);
    // Non-AVIF browsers render exactly as before: CDN fallback tier, same
    // transparent-pixel img.
    expect(fallbackSource).not.toHaveAttribute('type');
    expect(fallbackSource?.getAttribute('srcset')).toContain(
      'https://cdn.ogabassey.com'
    );
    expect(fallbackSource?.getAttribute('srcset')).not.toContain('/_hero/');
    expect(
      screen.getByRole('img', { name: 'Samsung Galaxy A27 5G' })
    ).toHaveAttribute('src', TRANSPARENT_PIXEL_SRC);
  });

  it('keeps the CDN AVIF tier when the snapshot is for another URL', () => {
    const { container } = render(
      <MobileLcpHeroImage
        alt="New arrival"
        imageFit="contain"
        shouldPrioritizeImage={true}
        snapshot={SNAPSHOT}
        src={ROTATED_SRC}
      />
    );

    const sources = mobileSources(container);
    expect(sources).toHaveLength(2);
    expect(sources[0]?.getAttribute('srcset')).toContain('format=avif');
    expect(sources[0]?.getAttribute('srcset')).not.toContain('/_hero/');
  });

  it('keeps the CDN AVIF tier without a snapshot', () => {
    const { container } = render(
      <MobileLcpHeroImage
        alt="Samsung Galaxy A27 5G"
        imageFit="contain"
        shouldPrioritizeImage={true}
        src={HERO_MOBILE_LCP_SRC}
      />
    );

    const sources = mobileSources(container);
    expect(sources[0]?.getAttribute('srcset')).toContain('format=avif');
    expect(sources[0]?.getAttribute('srcset')).not.toContain('/_hero/');
  });
});
