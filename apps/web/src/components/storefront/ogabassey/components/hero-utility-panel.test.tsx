import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>) => {
    const source = loader.toString();

    if (source.includes('UtilityModal')) {
      return ({
        isOpen,
        initialTab,
      }: {
        isOpen: boolean;
        initialTab?: string;
      }) =>
        isOpen ? (
          <div data-testid="utility-modal">{initialTab}</div>
        ) : null;
    }

    return () => null;
  },
}));

import { HeroUtilityPanel } from './hero-utility-panel';
import { HERO_MOBILE_UTILITY_PANEL_MIN_HEIGHT_CLASS } from './hero-mobile-geometry';

describe('HeroUtilityPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens the deferred utility modal with the selected tab', () => {
    render(<HeroUtilityPanel />);

    act(() => {
      fireEvent.click(screen.getAllByRole('button', { name: /airtime/i })[0]);
    });

    expect(screen.getByTestId('utility-modal')).toHaveTextContent('airtime');
  });

  it('keeps utility copy stable until the user selects an option', () => {
    render(<HeroUtilityPanel />);

    act(() => {
      vi.advanceTimersByTime(2500);
    });

    // All words stay mounted (stacked grid cells size the box to the longest
    // word once, so rotation never resizes it): inactive words are present
    // but visually hidden, the active word is visible.
    for (const word of screen.getAllByText(/data!/i)) {
      expect(word).toHaveClass('invisible');
      expect(word).toHaveAttribute('aria-hidden', 'true');
    }
    const activeWords = screen.getAllByText(/airtime!/i);
    expect(activeWords.length).toBeGreaterThan(0);
    for (const word of activeWords) {
      expect(word).not.toHaveClass('invisible');
    }

    fireEvent.click(screen.getAllByRole('button', { name: /data/i })[0]);

    expect(screen.getAllByText(/data!/i)[0]).toBeInTheDocument();
    expect(screen.getByTestId('utility-modal')).toHaveTextContent('data');
  });

  it('does not use content visibility on the above-fold utility panel', () => {
    const { container } = render(<HeroUtilityPanel />);

    expect(container.firstElementChild).not.toHaveClass(
      'content-auto'
    );
    expect(container.firstElementChild).not.toHaveClass(
      '[contain-intrinsic-size:1400px_260px]'
    );
  });

  it('rotates after engagement and stops after selecting a service', () => {
    render(<HeroUtilityPanel />);
    fireEvent.keyDown(window, { key: 'Tab' });
    act(() => { vi.advanceTimersByTime(2500); });
    // Rotation swaps visibility, not DOM presence: the newly active word is
    // shown, the previous one hides — while the stacked box keeps its size.
    for (const word of screen.getAllByText('Data!')) {
      expect(word).not.toHaveClass('invisible');
    }
    for (const word of screen.getAllByText('Airtime!')) {
      expect(word).toHaveClass('invisible');
    }
    fireEvent.click(screen.getAllByRole('button', { name: /airtime/i })[0]);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getAllByText('Airtime!')[0]).toBeInTheDocument();
  });

  it('shares the mobile minimum height with the publication-safe fallback', () => {
    const { container } = render(<HeroUtilityPanel />);

    expect(
      container.querySelector('[data-ogabassey-mobile-utility-panel="true"]')
    ).toHaveClass(HERO_MOBILE_UTILITY_PANEL_MIN_HEIGHT_CLASS);
  });

  it('respects reduced motion after engagement', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    render(<HeroUtilityPanel />);
    fireEvent.keyDown(window, { key: 'Tab' });
    act(() => { vi.advanceTimersByTime(10000); });
    for (const word of screen.getAllByText('Data!')) {
      expect(word).toHaveClass('invisible');
    }
    const activeWords = screen.getAllByText('Airtime!');
    expect(activeWords.length).toBeGreaterThan(0);
    for (const word of activeWords) {
      expect(word).not.toHaveClass('invisible');
    }
  });

  it('cleans up its timer and engagement listeners on unmount', () => {
    const { unmount } = render(<HeroUtilityPanel />);
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
