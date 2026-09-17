import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HERO_MOBILE_CONTROLS_ROW_CLASSES,
  HERO_MOBILE_PANEL_CLASSES,
  HERO_MOBILE_WRAPPER_CLASSES,
} from '@/components/storefront/ogabassey/components/hero-mobile-geometry';
import { OgabasseyHomeHeroReserveFallback } from './ogabassey-home-hero-reserve-fallback';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function firstClass(token: string): string {
  const first = token.split(' ')[0] ?? token;
  // Escape Tailwind variant separators (e.g. `md:hidden`) for querySelector.
  return first.replace(/:/g, '\\:');
}

describe('OgabasseyHomeHeroReserveFallback', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reserves the streamed mobile hero geometry (panel + controls row)', () => {
    const { container } = render(<OgabasseyHomeHeroReserveFallback />);

    const root = container.querySelector(
      '[data-ogabassey-home-hero-reserve-fallback="true"]'
    );
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute('aria-hidden', 'true');

    // Same section wrapper the real Hero renders, so offsets match.
    const section = root?.querySelector('section');
    expect(section?.className).toContain('max-w-[1400px]');

    const wrapper = root?.querySelector(
      '[data-ogabassey-home-hero-reserve-mobile="true"]'
    );
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveClass(
      ...HERO_MOBILE_WRAPPER_CLASSES.split(' ').map((c) =>
        c.replace(/\\/g, '')
      )
    );
    expect(
      wrapper?.querySelector(`.${firstClass(HERO_MOBILE_PANEL_CLASSES)}`)
    ).not.toBeNull();
    expect(
      wrapper?.querySelector(`.${firstClass(HERO_MOBILE_CONTROLS_ROW_CLASSES)}`)
    ).not.toBeNull();
  });

  it('reserves the desktop hero skeleton and the utility panel', () => {
    const { container } = render(<OgabasseyHomeHeroReserveFallback />);

    const desktop = container.querySelector(
      '[data-ogabassey-home-hero-reserve-fallback="true"] .hidden.md\\:grid'
    );
    expect(desktop).not.toBeNull();
    // The utility panel renders for real (exact height on both viewports).
    expect(
      container.querySelector('[data-ogabassey-hero-utility="true"]')
    ).not.toBeNull();
  });

  it('omits the mobile skeleton when the mobile carousel is omitted', () => {
    const { container } = render(
      <OgabasseyHomeHeroReserveFallback omitMobileCarousel />
    );

    expect(
      container.querySelector(
        '[data-ogabassey-home-hero-reserve-mobile="true"]'
      )
    ).toBeNull();
    expect(
      container.querySelector('[data-ogabassey-hero-utility="true"]')
    ).not.toBeNull();
  });

  it('exposes no links or headings even to crawlers (aria-hidden is not crawler-hidden)', () => {
    render(<OgabasseyHomeHeroReserveFallback />);

    expect(screen.queryByRole('link', { hidden: true })).toBeNull();
    expect(screen.queryByRole('heading', { hidden: true })).toBeNull();
  });
});
