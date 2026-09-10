import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGadgetPattern = vi.hoisted(() => vi.fn());
const mockMobileCarousel = vi.hoisted(() => vi.fn());
const mockDesktopGrid = vi.hoisted(() => vi.fn());
const mockEmptyMobileHero = vi.hoisted(() => vi.fn());

vi.mock('./hero-mobile-carousel', () => ({
  HeroMobileCarousel: (props: Record<string, unknown>) => {
    mockMobileCarousel(props);
    return (
      <div
        role="region"
        aria-label="Featured launch product carousel"
      />
    );
  },
}));

vi.mock('./hero-desktop-grid', () => ({
  HeroDesktopGrid: (props: Record<string, unknown>) => {
    mockDesktopGrid(props);
    return (
      <section aria-label="Featured products" data-ogabassey-desktop-hero="true" />
    );
  },
}));

vi.mock('./GadgetPattern', () => ({
  GadgetPattern: (props: { opacity?: number }) => {
    mockGadgetPattern(props);
    return <div data-testid="gadget-pattern" />;
  },
}));

vi.mock('./hero-utility-panel', () => ({
  HeroUtilityPanel: () => (
    <aside aria-label="Hero utilities">Utility panel</aside>
  ),
}));

vi.mock('./ogabassey-empty-mobile-hero', () => ({
  OgabasseyEmptyMobileHero: () => {
    mockEmptyMobileHero();
    return <div data-testid="empty-mobile-hero" />;
  },
}));

import { Hero } from './Hero';
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
];

describe('Hero', () => {
  beforeEach(() => {
    mockGadgetPattern.mockClear();
    mockMobileCarousel.mockClear();
    mockDesktopGrid.mockClear();
    mockEmptyMobileHero.mockClear();
  });

  it('renders the sr-only storefront heading', () => {
    render(<Hero slides={SLIDES} />);

    expect(
      screen.getByRole('heading', { level: 1, name: /buy phones/i })
    ).toBeInTheDocument();
  });

  it('omits the mobile carousel when a committed text LCP already owns the slot', () => {
    render(<Hero omitMobileCarousel slides={SLIDES} />);

    expect(
      screen.getByRole('heading', { level: 1, name: /buy phones/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Featured launch product carousel' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Featured products' })
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ogabassey-mobile-hero-bg-extension]')
    ).not.toBeInTheDocument();
  });

  it('threads the launch slides to both the mobile carousel and the desktop grid', () => {
    render(<Hero slides={SLIDES} />);

    expect(mockMobileCarousel.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ slides: SLIDES })
    );
    expect(mockDesktopGrid.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ slides: SLIDES })
    );
  });

  it('preserves hero geometry when launch slides are empty', () => {
    const { container } = render(<Hero slides={[]} />);

    expect(
      screen.queryByRole('region', { name: 'Featured launch product carousel' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Featured products' })
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-ogabassey-empty-mobile-hero="true"]')
    ).toContainElement(screen.getByTestId('empty-mobile-hero'));
    expect(mockEmptyMobileHero).toHaveBeenCalledOnce();
    expect(
      container.querySelector('[data-ogabassey-empty-desktop-hero="true"]')
    ).toHaveClass('lg:h-[540px]');
  });

  it('extends the patterned mobile shell behind the carousel', () => {
    const { container } = render(<Hero slides={SLIDES} />);

    const mobileBackground = container.querySelector(
      '[data-ogabassey-mobile-hero-bg-extension="true"]'
    );

    expect(mobileBackground).toHaveClass(
      'h-28',
      'bg-[var(--ogabassey-shell-background)]'
    );
    expect(screen.getByTestId('gadget-pattern')).toBeInTheDocument();
    expect(mockGadgetPattern).toHaveBeenCalledWith({ opacity: 0.1 });
  });

  it('renders the utility panel chunk in the hero shell', () => {
    render(<Hero slides={SLIDES} />);

    expect(
      screen.getByRole('complementary', { name: /hero utilities/i })
    ).toBeInTheDocument();
  });
});
