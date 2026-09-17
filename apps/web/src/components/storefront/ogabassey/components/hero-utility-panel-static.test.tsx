import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HERO_MOBILE_UTILITY_PANEL_MIN_HEIGHT_CLASS } from './hero-mobile-geometry';
import { HeroUtilityPanelStatic } from './hero-utility-panel-static';

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

// Imported after the next/dynamic mock so the interactive panel (which defers
// its modal through next/dynamic) renders its closed-modal first frame.
import { HeroUtilityPanel } from './hero-utility-panel';

const OPTION_LABELS = ['Airtime', 'Data', 'Tv', 'Power', 'Gaming'];

function stubMatchMedia() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }))
  );
}

describe('HeroUtilityPanelStatic', () => {
  it('renders the utility copy and all five service options for both viewports', () => {
    const { container } = render(<HeroUtilityPanelStatic />);

    expect(
      container.querySelector('[data-ogabassey-hero-utility="true"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ogabassey-mobile-utility-panel="true"]')
    ).toHaveClass(HERO_MOBILE_UTILITY_PANEL_MIN_HEIGHT_CLASS);
    // Once for the mobile promo box, once for the desktop promo box.
    expect(screen.getAllByText(/we pay/i)).toHaveLength(2);

    for (const label of OPTION_LABELS) {
      // Once for the mobile grid, once for the desktop row.
      expect(screen.getAllByText(label)).toHaveLength(2);
    }

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(10);
    for (const button of buttons) {
      expect(button).toHaveAttribute('type', 'button');
    }
  });

  it('renders zero JavaScript hooks: no svg icons, links, or headings', () => {
    const { container } = render(<HeroUtilityPanelStatic />);

    // The sized circles reserve the icon boxes; the lucide <svg> modules stay
    // in the deferred interactive chunk.
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByRole('link', { hidden: true })).toBeNull();
    expect(screen.queryByRole('heading', { hidden: true })).toBeNull();
    expect(container.firstElementChild).not.toHaveClass('content-auto');
  });

  it('matches the interactive panel first-frame text, buttons, and boxes', () => {
    stubMatchMedia();

    const { container: staticContainer, unmount: unmountStatic } = render(
      <HeroUtilityPanelStatic />
    );
    const { container: liveContainer, unmount: unmountLive } = render(
      <HeroUtilityPanel />
    );

    try {
      const staticRoot = staticContainer.querySelector(
        '[data-ogabassey-hero-utility="true"]'
      );
      const liveRoot = liveContainer.querySelector(
        '[data-ogabassey-hero-utility="true"]'
      );
      expect(staticRoot).not.toBeNull();
      expect(liveRoot).not.toBeNull();

      // Same copy in the same order (stacked promo words included), so the
      // activation swap is paint-only and crawlers see identical text.
      expect(staticRoot?.textContent).toBe(liveRoot?.textContent);

      // Same boxes: root and every option button carry identical classes.
      expect(staticRoot?.className).toBe(liveRoot?.className);
      const staticButtons = staticRoot
        ? Array.from(staticRoot.querySelectorAll('button'))
        : [];
      const liveButtons = liveRoot
        ? Array.from(liveRoot.querySelectorAll('button'))
        : [];
      expect(staticButtons).toHaveLength(liveButtons.length);
      expect(liveButtons.length).toBeGreaterThan(0);
      for (const [index, staticButton] of staticButtons.entries()) {
        expect(staticButton.className).toBe(liveButtons[index]?.className);
      }

      // The only structural delta is the deferred icon payload: the
      // interactive panel renders one <svg> per option, the static twin an
      // empty fixed box in the same circle.
      expect(liveRoot?.querySelectorAll('svg').length).toBe(
        liveButtons.length
      );
      expect(staticRoot?.querySelectorAll('svg').length).toBe(0);
    } finally {
      unmountStatic();
      unmountLive();
      vi.unstubAllGlobals();
    }
  });
});
