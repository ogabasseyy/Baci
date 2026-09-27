import { render } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HeroMobileCarousel } from './hero-mobile-carousel';
import {
  HERO_MOBILE_CONTROLS_ROW_CLASSES,
  HERO_MOBILE_PANEL_CLASSES,
  HERO_MOBILE_SLIDE_GRID_CLASSES,
} from './hero-mobile-geometry';

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
    <a data-prefetch={String(prefetch)} href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/image', () => ({
  default: () => null,
  getImageProps: vi.fn(({ sizes, src }) => ({
    props: { sizes, src, srcSet: `${src} 960w` },
  })),
}));

beforeEach(() => {
  // jsdom has no matchMedia; the carousel's reduced-motion probe needs it.
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

const SLIDES = [
  {
    kind: 'product' as const,
    id: 'p1',
    name: 'Tecno Spark 40 Pro',
    priceLabel: '₦250,000',
    href: '/smartphones/tecno-spark-40-pro',
    imageUrl: 'https://cdn.ogabassey.com/core-assets/products/tecno.avif',
    imageAlt: 'Tecno Spark 40 Pro',
    ctaLabel: 'Shop now',
  },
  {
    kind: 'product' as const,
    id: 'p2',
    name: 'Dell XPS 16',
    priceLabel: '₦3,500,000',
    href: '/gaming-laptops/dell-xps-16',
    imageUrl: 'https://cdn.ogabassey.com/core-assets/products/dell.avif',
    imageAlt: 'Dell XPS 16',
    ctaLabel: 'Shop now',
  },
];

describe('permanent hero mobile geometry', () => {
  function classesOf(container: HTMLElement, selector: string): string {
    const node = container.querySelector(selector);
    expect(node, `selector not found: ${selector}`).not.toBeNull();
    return (node as HTMLElement).className;
  }

  it('renders the carousel panel and first slide with the shared fixed geometry', () => {
    const carousel = render(<HeroMobileCarousel slides={SLIDES} />).container;

    const carouselPanel = classesOf(
      carousel,
      '[data-ogabassey-mobile-hero-panel]'
    );
    expect(carouselPanel).toBe(HERO_MOBILE_PANEL_CLASSES);
    expect(
      classesOf(carousel, '[data-ogabassey-mobile-hero-panel] [role="group"]')
    ).toContain(HERO_MOBILE_SLIDE_GRID_CLASSES);
  });

  it('reserves the permanent controls row height when multiple slides exist', () => {
    const carousel = render(<HeroMobileCarousel slides={SLIDES} />).container;

    const row = carousel.querySelector('.mt-2.flex.items-center');
    expect(row).not.toBeNull();
    expect((row as HTMLElement).className).toBe(
      HERO_MOBILE_CONTROLS_ROW_CLASSES
    );
    expect(row?.querySelectorAll('.h-11').length).toBeGreaterThanOrEqual(
      SLIDES.length
    );
  });

  it('reserves the controls row slot invisibly for a single slide', () => {
    // Contract change (Codex round-2 CLS decision): the streaming reserve
    // fallback always bets on a multi-slide hero and paints the 52px
    // controls row, so a resolved single-slide hero keeps the same slot
    // (empty but sized) instead of omitting it — otherwise the
    // fallback-to-content swap shifts everything below the hero up by the
    // missing row on every mobile load. The slot must therefore match the
    // live row geometry, stay hidden, and expose no interactive controls.
    const carousel = render(
      <HeroMobileCarousel slides={[SLIDES[0]]} />
    ).container;

    const row = carousel.querySelector('.mt-2.flex.items-center');
    expect(row).not.toBeNull();
    expect((row as HTMLElement).className).toBe(
      `${HERO_MOBILE_CONTROLS_ROW_CLASSES} invisible`
    );
    expect(row?.getAttribute('aria-hidden')).toBe('true');
    expect(row?.querySelector('button, a')).toBeNull();
  });

  it('renders slide 0 with the cached shell image URL', () => {
    const carousel = render(<HeroMobileCarousel slides={SLIDES} />).container;

    const carouselSource = carousel.querySelector('picture source');
    expect(carouselSource?.getAttribute('srcset')).toContain(SLIDES[0].imageUrl);
    const carouselImg = carousel.querySelector('picture img');
    expect(carouselImg?.getAttribute('alt')).toBe(SLIDES[0].imageAlt);
  });
});
