import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TRANSPARENT_PIXEL_SRC } from './hero-mobile-image-config';
import { MobileLcpHeroImage } from './mobile-lcp-hero-image';

// MobileLcpHeroImage takes arbitrary launch product images, so these are plain
// product fixtures rather than the retired hardcoded hero-image constants.
const HERO_MOBILE_LCP_SRC = 'https://cdn.ogabassey.com/products/a27.avif';
const HERO_MOBILE_LCP_INLINE_SRC =
  'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUI=';

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

describe('MobileLcpHeroImage', () => {
  beforeEach(() => {
    mockGetImageProps.mockClear();
  });

  it('renders a viewport-scoped product image source without a stale static fallback', () => {
    document.head.replaceChildren();

    const { container } = render(
      <MobileLcpHeroImage
        alt="Samsung Galaxy A27 5G"
        imageFit="contain"
        shouldPrioritizeImage={true}
        src={HERO_MOBILE_LCP_SRC}
      />
    );

    expect(mockGetImageProps).toHaveBeenCalledTimes(1);
    expect(mockGetImageProps).toHaveBeenCalledWith(
      expect.objectContaining({
        decoding: 'sync',
        fetchPriority: 'high',
        loader: expect.any(Function),
        loading: 'eager',
        quality: 70,
        src: HERO_MOBILE_LCP_SRC,
      })
    );
    expect(
      document.head.querySelector(
        `link[rel="preload"][href="${HERO_MOBILE_LCP_SRC}"]`
      )
    ).toBeNull();

    const lcpImage = screen.getByRole('img', {
      name: 'Samsung Galaxy A27 5G',
    });
    expect(lcpImage).toHaveAttribute('loading', 'eager');
    expect(lcpImage).toHaveAttribute('decoding', 'sync');
    expect(lcpImage).toHaveAttribute('src', TRANSPARENT_PIXEL_SRC);
    expect(lcpImage).toHaveAttribute('fetchpriority', 'high');
    expect(lcpImage).not.toHaveAttribute('srcset');

    // AVIF tier + decodable fallback (per-format URLs) — never one
    // `format=auto` body, which CF Free serves to every client (AVIF bytes to
    // non-AVIF browsers). AVIF <source> first so capable browsers pick it.
    const mobileSources = container.querySelectorAll(
      'source[media="(max-width: 767px)"]'
    );
    expect(mobileSources).toHaveLength(2);
    const [avifSource, fallbackSource] = mobileSources;
    expect(avifSource).toHaveAttribute('type', 'image/avif');
    expect(avifSource?.getAttribute('srcset')).toContain('format=avif');
    expect(avifSource?.getAttribute('srcset')).toContain(
      '/core-assets/products/a27.avif'
    );
    expect(fallbackSource).not.toHaveAttribute('type');
    expect(fallbackSource?.getAttribute('srcset')).toContain('format=jpeg');
    expect(fallbackSource).toHaveAttribute(
      'sizes',
      '(max-width: 767px) 40vw, 50vw'
    );
    expect(container.innerHTML).not.toContain('format=auto');
  });

  it('uses the inline source for the mobile LCP candidate when provided', () => {
    const { container } = render(
      <MobileLcpHeroImage
        alt="Samsung Galaxy A27 5G"
        imageFit="contain"
        inlineSrc={HERO_MOBILE_LCP_INLINE_SRC}
        shouldPrioritizeImage={true}
        src={HERO_MOBILE_LCP_SRC}
      />
    );

    expect(container.querySelector('source')).toHaveAttribute(
      'srcset',
      HERO_MOBILE_LCP_INLINE_SRC
    );
    expect(container.querySelector('source')).not.toHaveAttribute('sizes');
    expect(
      screen.getByRole('img', { name: 'Samsung Galaxy A27 5G' })
    ).toHaveAttribute('src', TRANSPARENT_PIXEL_SRC);
  });

  it('omits sizes when image props return a single source candidate', () => {
    mockGetImageProps.mockImplementationOnce((props: Record<string, unknown>) => ({
      props: {
        alt: props.alt,
        decoding: props.decoding,
        fetchPriority: props.fetchPriority,
        height: props.height,
        loading: props.loading,
        sizes: props.sizes,
        src: props.src,
        width: props.width,
      },
    }));

    const { container } = render(
      <MobileLcpHeroImage
        alt="Samsung Galaxy A27 5G"
        imageFit="contain"
        shouldPrioritizeImage={true}
        src={HERO_MOBILE_LCP_SRC}
      />
    );

    expect(container.querySelector('source')).not.toHaveAttribute('sizes');
    expect(
      screen.getByRole('img', { name: 'Samsung Galaxy A27 5G' })
    ).not.toHaveAttribute('sizes');
  });

  it('lets the first mobile product image fill its column instead of rendering as an 80px thumbnail', () => {
    const { container } = render(
      <MobileLcpHeroImage
        alt="Samsung Galaxy A27 5G"
        imageFit="contain"
        shouldPrioritizeImage={true}
        src={HERO_MOBILE_LCP_SRC}
      />
    );

    const picture = container.querySelector('picture');
    const lcpImage = screen.getByRole('img', {
      name: 'Samsung Galaxy A27 5G',
    });

    expect(picture).toHaveClass('h-full', 'w-full');
    expect(picture).not.toHaveClass('max-h-20', 'max-w-20');
    expect(lcpImage).toHaveClass('h-full', 'w-full');
    expect(lcpImage).not.toHaveClass('max-h-20', 'max-w-20');
  });

  it('keeps the img fallback transparent so desktop does not fetch the mobile source', () => {
    render(
      <MobileLcpHeroImage
        alt="Samsung Galaxy A27 5G"
        imageFit="contain"
        shouldPrioritizeImage={false}
        src={HERO_MOBILE_LCP_SRC}
      />
    );

    const lcpImage = screen.getByRole('img', {
      name: 'Samsung Galaxy A27 5G',
    });
    expect(lcpImage).toHaveAttribute(
      'src',
      expect.stringMatching(/^data:image\/gif/)
    );
    expect(lcpImage).not.toHaveAttribute('fetchpriority');
    expect(lcpImage).not.toHaveAttribute('srcset');
  });
});
