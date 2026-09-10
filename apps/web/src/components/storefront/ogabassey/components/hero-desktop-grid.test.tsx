import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
  } & Record<string, unknown>) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => (
    <img
      {...Object.fromEntries(
        Object.entries(props).filter(
          ([key]) => key !== 'fill' && key !== 'priority' && key !== 'unoptimized'
        )
      )}
      alt={String(props.alt ?? '')}
      data-unoptimized={String(Boolean(props.unoptimized))}
    />
  ),
  getImageProps: ({
    src,
    sizes,
    alt,
    loading,
    fetchPriority,
    decoding,
    width,
    height,
    loader,
    quality,
  }: Record<string, unknown>) => {
    const imageSrc = String(src);
    const resolvedSrc =
      typeof loader === 'function'
        ? loader({ src: imageSrc, width: Number(width), quality: Number(quality) })
        : imageSrc;
    return {
      props: {
        src: resolvedSrc,
        srcSet: `${resolvedSrc} ${String(width)}w`,
        sizes,
        alt,
        loading,
        fetchPriority,
        decoding,
        width,
        height,
      },
    };
  },
}));

import { HeroDesktopGrid } from './hero-desktop-grid';
import type { LaunchProductSlide } from './LaunchCarousel';

function makeSlide(
  overrides: Partial<LaunchProductSlide> & Pick<LaunchProductSlide, 'id'>
): LaunchProductSlide {
  return {
    kind: 'product',
    name: `Product ${overrides.id}`,
    priceLabel: '₦100,000',
    href: `/ogabassey/smartphones/product-${overrides.id}`,
    imageUrl: `https://cdn.ogabassey.com/products/product-${overrides.id}.avif`,
    imageAlt: `Product ${overrides.id} image`,
    ctaLabel: 'Shop now',
    ...overrides,
  };
}

const SLIDES: LaunchProductSlide[] = [
  makeSlide({
    id: '1',
    name: 'Samsung Galaxy A27 5G',
    priceLabel: '₦50,000',
    href: '/ogabassey/smartphones/samsung-galaxy-a27-5g',
    ctaLabel: 'Pre-order now',
  }),
  makeSlide({
    id: '2',
    name: 'Itel Power 80',
    href: '/ogabassey/smartphones/itel-power-80-128gb-4gb',
  }),
  makeSlide({ id: '3', name: 'Itel IT2160' }),
  makeSlide({ id: '4', name: 'Should Not Render' }),
];

describe('HeroDesktopGrid', () => {
  it('renders the first launch product as the big hero with its price, CTA and PDP deep-link', () => {
    const { container } = render(<HeroDesktopGrid slides={SLIDES} />);

    expect(
      container.querySelector('[data-ogabassey-desktop-hero="true"]')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Featured products' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Samsung Galaxy A27 5G' })
    ).toBeInTheDocument();
    expect(screen.getByText('₦50,000')).toBeInTheDocument();

    const bigLink = screen.getByRole('link', {
      name: 'Samsung Galaxy A27 5G — Pre-order now',
    });
    expect(bigLink).toHaveAttribute(
      'href',
      '/ogabassey/smartphones/samsung-galaxy-a27-5g'
    );
    expect(bigLink).toHaveAttribute('data-prefetch', 'false');
  });

  it('serves the big hero image as a desktop-scoped lazy picture with an explicit AVIF tier', () => {
    const { container } = render(<HeroDesktopGrid slides={SLIDES} />);

    const bigPicture = container.querySelector('picture');
    const sources = bigPicture?.querySelectorAll(
      'source[media="(min-width: 768px)"]'
    );
    // Per-format URLs (AVIF tier + decodable fallback), never one `format=auto`
    // body: CF Free ignores `Vary: Accept`, so a shared cache body serves AVIF
    // bytes to non-AVIF browsers.
    expect(sources).toHaveLength(2);
    expect(sources?.[0]).toHaveAttribute('type', 'image/avif');
    expect(sources?.[0]?.getAttribute('srcset')).toBe(
      'https://cdn.ogabassey.com/image/width=800,quality=70,format=avif/core-assets/products/product-1.avif 800w'
    );
    expect(sources?.[1]).not.toHaveAttribute('type');
    expect(sources?.[1]?.getAttribute('srcset')).toBe(
      'https://cdn.ogabassey.com/image/width=800,quality=70,format=jpeg/core-assets/products/product-1.avif 800w'
    );
    expect(container.innerHTML).not.toContain('format=auto');

    const img = container.querySelector('picture img');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('fetchpriority', 'low');
  });

  it('serves external desktop images with only the fallback source when no AVIF tier exists', () => {
    const externalSlide = makeSlide({
      id: 'external',
      imageUrl: 'https://images.example.com/hero.jpg',
      name: 'External Hero',
    });

    const { container } = render(<HeroDesktopGrid slides={[externalSlide]} />);

    const picture = container.querySelector('picture');
    const sources = picture?.querySelectorAll(
      'source[media="(min-width: 768px)"]'
    );
    expect(sources).toHaveLength(1);
    expect(sources?.[0]).not.toHaveAttribute('type');
    expect(sources?.[0]?.getAttribute('srcset')).toBe(
      'https://images.example.com/hero.jpg?w=800&q=70 800w'
    );

    const img = container.querySelector('picture img');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('fetchpriority', 'low');
    expect(container.innerHTML).not.toContain('format=avif');
  });

  it('renders exactly two side cards from the next launch products, deep-linked', () => {
    render(<HeroDesktopGrid slides={SLIDES} />);

    const powerLink = screen.getByRole('link', {
      name: 'Itel Power 80 — Shop now',
    });
    expect(powerLink).toHaveAttribute(
      'href',
      '/ogabassey/smartphones/itel-power-80-128gb-4gb'
    );

    expect(
      screen.getByRole('heading', { name: 'Itel IT2160' })
    ).toBeInTheDocument();
    // 4th slide must not render (big + 2 side cards only).
    expect(
      screen.queryByRole('heading', { name: 'Should Not Render' })
    ).not.toBeInTheDocument();
  });


  it('media-gates side-card images so mobile receives transparent fallbacks', () => {
    const { container } = render(<HeroDesktopGrid slides={SLIDES} />);

    // Three pictures (big + 2 side), each with an AVIF tier + decodable
    // fallback source → 6 sources, all desktop-media-scoped.
    const pictures = Array.from(container.querySelectorAll('picture'));
    expect(pictures).toHaveLength(3);
    for (const picture of pictures) {
      const pictureSources = picture.querySelectorAll(
        'source[media="(min-width: 768px)"]'
      );
      expect(pictureSources).toHaveLength(2);
      expect(pictureSources[0]).toHaveAttribute('type', 'image/avif');
      expect(pictureSources[1]).not.toHaveAttribute('type');
    }

    const sideSources = pictures[1]?.querySelectorAll('source');
    expect(sideSources?.[0]?.getAttribute('srcset')).toBe(
      'https://cdn.ogabassey.com/image/width=320,quality=70,format=avif/core-assets/products/product-2.avif 320w'
    );
    expect(sideSources?.[1]?.getAttribute('srcset')).toBe(
      'https://cdn.ogabassey.com/image/width=320,quality=70,format=jpeg/core-assets/products/product-2.avif 320w'
    );

    const images = Array.from(container.querySelectorAll('picture img'));
    expect(images[1]).toHaveAttribute(
      'src',
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
    );
    expect(images[1]).toHaveAttribute('loading', 'lazy');
  });

  it('lets the big card fill the desktop grid when there are no side cards', () => {
    const { container } = render(
      <HeroDesktopGrid slides={[SLIDES[0] as LaunchProductSlide]} />
    );

    const bigLink = screen.getByRole('link', {
      name: 'Samsung Galaxy A27 5G — Pre-order now',
    });
    expect(bigLink.className).toContain('lg:col-span-5');
    expect(
      Array.from(container.querySelectorAll('[class]')).some((node) =>
        (node.getAttribute('class') ?? '').includes('lg:col-span-2')
      )
    ).toBe(false);
  });

  it('renders nothing when there are no launch products', () => {
    const { container } = render(<HeroDesktopGrid slides={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
