import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HeroStreamFallback } from './hero-stream-fallback';
import type { LaunchProductSlide } from './LaunchCarousel';

const slides: LaunchProductSlide[] = [
  {
    id: 'authorized-first',
    kind: 'product',
    name: 'Authorized first phone',
    priceLabel: '₦100,000',
    href: '/phones/first',
    imageUrl: 'https://cdn.ogabassey.com/products/first.avif',
    imageAlt: 'First phone',
    ctaLabel: 'Shop now',
  },
  {
    id: 'authorized-second',
    kind: 'product',
    name: 'Second phone',
    priceLabel: '₦200,000',
    href: '/phones/second',
    imageUrl: 'https://cdn.ogabassey.com/products/second.avif',
    imageAlt: 'Second phone',
    ctaLabel: 'Shop now',
  },
];

describe('HeroStreamFallback', () => {
  it('paints the authorized first slide with a usable native link before hydration', () => {
    const { container } = render(<HeroStreamFallback slides={slides} />);
    const frame = container.querySelector(
      '[data-ogabassey-hero-stream-fallback]'
    );
    const panel = frame?.querySelector('[data-ogabassey-mobile-hero-panel]');
    expect(frame).not.toHaveAttribute('inert');
    expect(frame).not.toHaveAttribute('aria-hidden');
    expect(panel?.querySelector('a')).toHaveAttribute('href', '/phones/first');
    expect(panel).toHaveTextContent('Authorized first phone');
    expect(panel).not.toHaveTextContent('Second phone');
    expect(panel?.querySelector('img')).toHaveAttribute('alt', 'First phone');
    expect(panel?.querySelector('source')).toHaveAttribute(
      'media',
      '(max-width: 767px)'
    );
    expect(
      frame?.querySelector('[data-ogabassey-desktop-hero]')
    ).not.toBeNull();
    expect(
      frame?.querySelector('[data-ogabassey-hero-utility]')
    ).not.toBeNull();
  });

  it('emits only neutral geometry when the authorized feed is empty', () => {
    const { container } = render(<HeroStreamFallback slides={[]} />);
    expect(
      container.querySelector('[data-ogabassey-home-hero-reserve-fallback]')
    ).not.toBeNull();
    expect(container.querySelector('h2')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('preserves the document heading only when the hero owns it', () => {
    const { container, rerender } = render(
      <HeroStreamFallback slides={slides} />
    );
    expect(container.querySelector('h1')).toHaveTextContent(
      'OgaBassey - Buy Phones'
    );
    rerender(<HeroStreamFallback slides={slides} omitDocumentHeading />);
    expect(container.querySelector('h1')).toBeNull();
  });

  it('does not introduce a mobile image request when that carousel is omitted', () => {
    const { container } = render(
      <HeroStreamFallback slides={slides} omitMobileCarousel />
    );
    expect(
      container.querySelector('[data-ogabassey-mobile-hero-panel]')
    ).toBeNull();
    expect(
      container.querySelector('[data-ogabassey-desktop-hero]')
    ).not.toBeNull();
  });
});
