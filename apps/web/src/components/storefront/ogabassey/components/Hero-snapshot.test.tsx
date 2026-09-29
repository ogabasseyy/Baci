import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMobileCarousel = vi.hoisted(() => vi.fn());
const mockDesktopGrid = vi.hoisted(() => vi.fn());

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
  GadgetPattern: () => <div data-testid="gadget-pattern" />,
}));

vi.mock('./hero-utility-panel-gate', () => ({
  HeroUtilityPanelGate: () => (
    <aside aria-label="Hero utilities">Utility panel</aside>
  ),
}));

vi.mock('./ogabassey-empty-mobile-hero', () => ({
  OgabasseyEmptyMobileHero: () => <div data-testid="empty-mobile-hero" />,
}));

import type { OgabasseyHomeHeroSnapshot } from '@/lib/ogabassey-home-hero-snapshot-types';
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
    ctaLabel: 'Shop now',
  },
];

const SNAPSHOT: OgabasseyHomeHeroSnapshot = {
  sourceUrl: 'https://cdn.ogabassey.com/products/a27.avif',
  srcSet: '/_hero/ogabassey/abc123-640.avif 640w',
  href: '/_hero/ogabassey/abc123-640.avif',
};

describe('Hero snapshot threading', () => {
  beforeEach(() => {
    mockMobileCarousel.mockClear();
    mockDesktopGrid.mockClear();
  });

  it('passes the slide-0 snapshot to the mobile carousel only', () => {
    render(<Hero slides={SLIDES} slideZeroSnapshot={SNAPSHOT} />);

    expect(mockMobileCarousel).toHaveBeenCalledTimes(1);
    expect(mockMobileCarousel).toHaveBeenCalledWith(
      expect.objectContaining({ slideZeroSnapshot: SNAPSHOT })
    );
    // Desktop grid always renders CDN bytes: it never receives the prop.
    expect(mockDesktopGrid).toHaveBeenCalledTimes(1);
    expect(mockDesktopGrid).toHaveBeenCalledWith(
      expect.not.objectContaining({ slideZeroSnapshot: expect.anything() })
    );
  });

  it('renders both viewports without a snapshot (legacy CDN path)', () => {
    render(<Hero slides={SLIDES} />);

    expect(mockMobileCarousel).toHaveBeenCalledWith(
      expect.objectContaining({ slideZeroSnapshot: undefined })
    );
    expect(mockDesktopGrid).toHaveBeenCalledTimes(1);
  });
});
