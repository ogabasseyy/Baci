import { act, render } from '@testing-library/react';
import { vi } from 'vitest';
import { HeroUtilityPanelGate } from './hero-utility-panel-gate';

let observerCallback: IntersectionObserverCallback | null = null;

/** Fake timers, viewport observer, and silenced console.error per test. */
export function setupGateHarness() {
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
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

export function teardownGateHarness(
  consoleErrorSpy: ReturnType<typeof vi.spyOn>
) {
  consoleErrorSpy.mockRestore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
}

export function renderGate(loadPanelModule?: () => Promise<never>) {
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
    <HeroUtilityPanelGate loadPanelModule={loader as never} timeoutMs={1000} />
  );
  return { loader: loader as ReturnType<typeof vi.fn>, ...utils };
}

/**
 * Flush the mocked post-LCP signal through effects so the gate arms its
 * observer and backstop — the test-side equivalent of LCP settling in
 * production. Tests that activate via interaction skip this; tests that
 * activate via intersection or the backstop need it first.
 */
export async function settleLcpSignal() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

export function fireViewportApproach() {
  observerCallback?.(
    [{ isIntersecting: true } as IntersectionObserverEntry],
    {} as IntersectionObserver
  );
}

/** Panel stub echoing the replayed fallback option for tap-replay tests. */
export function echoPanelLoader() {
  return vi.fn(() =>
    Promise.resolve({
      HeroUtilityPanel: ({
        pendingUtilityTab,
      }: {
        pendingUtilityTab?: string | null;
      }) => (
        <div
          data-testid="interactive-utility-panel"
          data-pending={pendingUtilityTab ?? 'none'}
        />
      ),
    })
  );
}
