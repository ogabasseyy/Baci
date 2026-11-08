import { render, screen } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  // Simulate shells without matchMedia (some test/SSR environments):
  // the carousel must not crash — the decorative reduced-motion gate is
  // the only thing that depends on it.
  Object.defineProperty(window, 'matchMedia', {
    value: undefined,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const mockGetImageProps = vi.hoisted(() =>
  vi.fn((props: Record<string, unknown>) => ({
    props: {
      alt: props.alt,
      decoding: props.decoding,
      fetchPriority: props.fetchPriority,
      height: props.height,
      loading: props.loading,
      sizes: props.sizes,
      src: props.src,
      srcSet: `${String(props.src)} 640w, ${String(props.src)} 960w`,
      width: props.width,
    },
  }))
);

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
          ([key]) => key !== 'fill' && key !== 'priority'
        )
      )}
      alt={String(props.alt ?? '')}
      data-priority={String(Boolean(props.priority))}
    />
  ),
  getImageProps: mockGetImageProps,
}));

import { HeroMobileCarousel } from './hero-mobile-carousel';
import type { LaunchProductSlide } from './LaunchCarousel';

const SLIDES: LaunchProductSlide[] = [
  {
    kind: 'product',
    id: '1',
    name: 'Samsung Galaxy A27 5G',
    priceLabel: '₦50,000',
    href: '/ogabassey/smartphones/samsung-galaxy-a27-5g',
    imageUrl: 'https://cdn.ogabassey.com/products/a27.avif',
    imageAlt: 'Samsung Galaxy A27 5G',
    ctaLabel: 'Pre-order now',
  },
  {
    kind: 'product',
    id: '2',
    name: 'Itel Power 80',
    priceLabel: '₦60,000',
    href: '/ogabassey/smartphones/itel-power-80-128gb-4gb',
    imageUrl: 'https://cdn.ogabassey.com/products/power80.avif',
    imageAlt: 'Itel Power 80',
    ctaLabel: 'Shop now',
  },
];

describe('HeroMobileCarousel without window.matchMedia', () => {
  it('renders the hero without crashing when matchMedia is absent', () => {
    expect(window.matchMedia).toBeUndefined();

    const { unmount } = render(<HeroMobileCarousel slides={SLIDES} />);

    expect(
      screen.getByRole('heading', { name: 'Samsung Galaxy A27 5G' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /play auto-rotation/i })
    ).toBeInTheDocument();

    // Effect cleanup must also survive without a media-query subscription.
    expect(() => unmount()).not.toThrow();
  });

  it('keeps the PDP deep link crawlable when matchMedia is absent', () => {
    render(<HeroMobileCarousel slides={SLIDES} />);

    const link = screen.getByRole('link', {
      name: 'Samsung Galaxy A27 5G — Pre-order now',
    });
    expect(link).toHaveAttribute(
      'href',
      '/ogabassey/smartphones/samsung-galaxy-a27-5g'
    );
    expect(link).toHaveTextContent('Samsung Galaxy A27 5G — Pre-order now');
  });
});
