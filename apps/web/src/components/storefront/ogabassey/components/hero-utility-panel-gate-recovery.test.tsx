import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  renderGate,
  settleLcpSignal,
  setupGateHarness,
  teardownGateHarness,
} from './hero-utility-panel-gate-test-setup';

const mocks = vi.hoisted(() => ({
  // The gate defers to the post-LCP signal; resolve immediately so timing
  // stays deterministic under jsdom, which never emits LCP entries.
  waitForLcpWindowEnd: vi.fn(async () => undefined),
}));

vi.mock('@/lib/posthog/wait-for-lcp', () => ({
  waitForLcpWindowEnd: mocks.waitForLcpWindowEnd,
}));

describe('HeroUtilityPanelGate loading failure recovery', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = setupGateHarness();
  });

  afterEach(() => {
    teardownGateHarness(consoleErrorSpy);
  });

  it('keeps the static fallback and logs once when the module fails to load', async () => {
    const failingLoad = vi.fn(() =>
      Promise.reject(new Error('chunk failed'))
    );
    renderGate(failingLoad as never);
    await settleLcpSignal();

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

  it('retries the module load on the next interaction after a failure', async () => {
    // An offline or stale-deployment blip must not wedge the fallback
    // permanently: the following tap retries the import and swaps in the
    // panel when it succeeds.
    let shouldFail = true;
    const flakyLoad = vi.fn(() =>
      shouldFail
        ? Promise.reject(new Error('chunk failed'))
        : Promise.resolve({
            HeroUtilityPanel: () => (
              <div data-testid="interactive-utility-panel" />
            ),
          })
    );
    renderGate(flakyLoad as never);
    await settleLcpSignal();

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(flakyLoad).toHaveBeenCalledOnce();
    expect(
      screen.queryByTestId('interactive-utility-panel')
    ).not.toBeInTheDocument();

    shouldFail = false;
    await act(async () => {
      fireEvent.pointerDown(window);
      fireEvent.pointerUp(window);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(flakyLoad).toHaveBeenCalledTimes(2);
    expect(
      screen.getByTestId('interactive-utility-panel')
    ).toBeInTheDocument();
  });
});
