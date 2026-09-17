import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeroUtilityPanelGate } from './hero-utility-panel-gate';

describe('HeroUtilityPanelGate', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let observerCallback: IntersectionObserverCallback | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    observerCallback = null;
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function renderGate(loadPanelModule?: () => Promise<never>) {
    const loader =
      loadPanelModule ??
      vi.fn(() =>
        Promise.resolve({
          HeroUtilityPanel: () => (
            <div data-testid="interactive-utility-panel" />
          ),
        })
      );
    const utils = render(
      <HeroUtilityPanelGate
        loadPanelModule={loader as never}
        timeoutMs={1000}
      />
    );
    return { loader: loader as ReturnType<typeof vi.fn>, ...utils };
  }

  function fireViewportApproach() {
    observerCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
  }

  it('renders the inert static fallback without loading the panel module', () => {
    const { loader } = renderGate();

    expect(
      screen
        .getAllByText(/we pay/i)[0]
        ?.closest('[data-ogabassey-hero-utility="true"]')
    ).not.toBeNull();
    expect(
      document.querySelector('[data-ogabassey-hero-utility-gate="true"]')
    ).toHaveAttribute('inert');
    expect(loader).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('interactive-utility-panel')
    ).not.toBeInTheDocument();
  });

  it('loads the panel module once the panel approaches the viewport', async () => {
    const { loader } = renderGate();

    expect(loader).not.toHaveBeenCalled();

    await act(async () => {
      fireViewportApproach();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loader).toHaveBeenCalledOnce();
    expect(
      screen.getByTestId('interactive-utility-panel')
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-ogabassey-hero-utility-gate="true"]')
    ).toBeNull();
  });

  it('loads the panel on first pointer interaction before the viewport fires', async () => {
    const { loader } = renderGate();

    await act(async () => {
      fireEvent.pointerDown(window);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loader).toHaveBeenCalledOnce();
    expect(
      screen.getByTestId('interactive-utility-panel')
    ).toBeInTheDocument();
  });

  it('loads the panel on first keyboard interaction', async () => {
    const { loader } = renderGate();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Tab' });
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loader).toHaveBeenCalledOnce();
    expect(
      screen.getByTestId('interactive-utility-panel')
    ).toBeInTheDocument();
  });

  it('loads the panel module after the backstop timeout', async () => {
    const { loader } = renderGate();

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(loader).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loader).toHaveBeenCalledOnce();
    expect(
      screen.getByTestId('interactive-utility-panel')
    ).toBeInTheDocument();
  });

  it('keeps the static fallback and logs once when the module fails to load', async () => {
    const failingLoad = vi.fn(() =>
      Promise.reject(new Error('chunk failed'))
    );
    renderGate(failingLoad as never);

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(failingLoad).toHaveBeenCalledOnce();
    expect(
      screen
        .getAllByText(/we pay/i)[0]
        ?.closest('[data-ogabassey-hero-utility="true"]')
    ).not.toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });

  it('removes interaction listeners on unmount before activation', () => {
    const { loader, unmount } = renderGate();

    unmount();
    fireEvent.pointerDown(window);
    fireEvent.keyDown(window, { key: 'Tab' });

    expect(loader).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
