import { fireEvent, render, screen, within } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  // jsdom has no matchMedia; default to "no reduced-motion preference".
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
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

describe('HeroMobileCarousel', () => {
  it('renders the first product slide deep-linked to its PDP with prefetch disabled', () => {
    render(<HeroMobileCarousel slides={SLIDES} />);

    expect(
      screen.getByRole('heading', { name: 'Samsung Galaxy A27 5G' })
    ).toBeInTheDocument();
    expect(screen.getByText('₦50,000')).toBeInTheDocument();

    const link = screen.getByRole('link', {
      name: 'Samsung Galaxy A27 5G — Pre-order now',
    });
    expect(link).toHaveAttribute(
      'href',
      '/ogabassey/smartphones/samsung-galaxy-a27-5g'
    );
    expect(link).toHaveAttribute('data-prefetch', 'false');
    // Crawlable anchor text (visually-hidden span), not an empty anchor.
    expect(link).toHaveTextContent('Samsung Galaxy A27 5G — Pre-order now');
  });

  it('serves the first slide image as the eager, high-priority LCP picture', () => {
    const { container } = render(<HeroMobileCarousel slides={SLIDES} />);

    const lcpImg = container.querySelector('picture img');
    expect(lcpImg).toHaveAttribute('fetchpriority', 'high');
  });

  it('lazy-loads the first slide image when it cannot be LCP', () => {
    const { container } = render(
      <HeroMobileCarousel prioritizeFirstImage={false} slides={SLIDES} />
    );

    const firstImage = screen.getByRole('img', {
      name: 'Samsung Galaxy A27 5G',
    });
    expect(container.querySelector('picture')).not.toBeInTheDocument();
    expect(firstImage).toHaveAttribute('loading', 'lazy');
    expect(firstImage).not.toHaveAttribute('fetchpriority', 'high');
  });

  it('shows the progress-bar slide controls when there are multiple slides', () => {
    render(<HeroMobileCarousel slides={SLIDES} />);

    expect(
      screen.getByRole('group', { name: /hero carousel slide controls/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /go to hero slide 2/i })
    ).toBeInTheDocument();
  });

  it('defers inactive non-LCP slide images until their slide is selected', () => {
    render(<HeroMobileCarousel slides={SLIDES} />);

    expect(
      screen.queryByRole('img', { name: 'Itel Power 80' })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /go to hero slide 2/i }));

    expect(
      screen.getByRole('img', { name: 'Itel Power 80' })
    ).toBeInTheDocument();
  });

  it('omits the dot controls for a single slide', () => {
    render(<HeroMobileCarousel slides={[SLIDES[0]]} />);

    expect(
      screen.queryByRole('group', { name: /hero carousel slide controls/i })
    ).toBeNull();
  });

  it('keeps the hero media inside the clipped carousel panel', () => {
    render(<HeroMobileCarousel slides={SLIDES} />);

    const carouselPanel = screen.getByRole('region', {
      name: /featured launch product carousel/i,
    });
    within(carouselPanel).getByRole('link', {
      name: 'Samsung Galaxy A27 5G — Pre-order now',
    });
    within(carouselPanel).getByRole('img', {
      name: 'Samsung Galaxy A27 5G',
    });
  });

  it('returns null when there are no slides', () => {
    const { container } = render(<HeroMobileCarousel slides={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
