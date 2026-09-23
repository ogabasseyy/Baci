import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewportActivation } from './use-viewport-activation';

const mocks = vi.hoisted(() => ({
  // Only called when a test opts into deferUntilLcp; resolves immediately
  // unless a test pins the pending window.
  waitForLcpWindowEnd: vi.fn(async () => undefined),
}));

vi.mock('@/lib/posthog/wait-for-lcp', () => ({
  waitForLcpWindowEnd: mocks.waitForLcpWindowEnd,
}));

describe('useViewportActivation', () => {
  let observerCallback: IntersectionObserverCallback | null = null;

  function TestHarness() {
    const { ref, isActive } = useViewportActivation<HTMLDivElement>({
      timeoutMs: 5000,
    });

    return (
      <div>
        <div ref={ref}>target</div>
        <span>{isActive ? 'active' : 'idle'}</span>
      </div>
    );
  }

  function DeferredHarness() {
    const { ref, isActive } = useViewportActivation<HTMLDivElement>({
      timeoutMs: 5000,
      deferUntilLcp: true,
    });

    return (
      <div>
        <div ref={ref}>target</div>
        <span>{isActive ? 'active' : 'idle'}</span>
      </div>
    );
  }

  function fireIntersect() {
    observerCallback?.(
      [
        {
          isIntersecting: true,
          target: screen.getByText('target'),
        } as unknown as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    observerCallback = null;

    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }

      observe() {
        return;
      }

      disconnect() {
        return;
      }

      unobserve() {
        return;
      }

      takeRecords() {
        return [];
      }
    }

    global.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    vi.useRealTimers();
    observerCallback = null;
    delete (
      globalThis as { IntersectionObserver?: typeof IntersectionObserver }
    ).IntersectionObserver;
  });

  it('stays idle until the target enters the viewport', () => {
    render(<TestHarness />);

    expect(screen.getByText('idle')).toBeInTheDocument();

    act(() => {
      observerCallback?.(
        [
          {
            isIntersecting: true,
            target: screen.getByText('target'),
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver
      );
    });

    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('activates after the fallback timeout when still offscreen', () => {
    render(<TestHarness />);

    expect(screen.getByText('idle')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('never waits for LCP unless deferUntilLcp is set', () => {
    render(<TestHarness />);

    act(() => {
      fireIntersect();
    });

    expect(screen.getByText('active')).toBeInTheDocument();
    expect(mocks.waitForLcpWindowEnd).not.toHaveBeenCalled();
  });

  it('holds intersection and backstop until LCP settles when deferred', async () => {
    // A gate inside the initial viewport must not activate on hydration:
    // the observer fires immediately, but the chunk stays held until the
    // post-LCP signal (or interaction).
    let resolveLcpWindow: () => void = () => undefined;
    mocks.waitForLcpWindowEnd.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        resolveLcpWindow = () => resolve(undefined);
      })
    );
    render(<DeferredHarness />);

    await act(async () => {
      fireIntersect();
      await Promise.resolve();
    });
    expect(screen.getByText('idle')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('idle')).toBeInTheDocument();

    await act(async () => {
      resolveLcpWindow();
      await Promise.resolve();
    });
    await act(async () => {
      fireIntersect();
      await Promise.resolve();
    });

    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('activates on interaction while LCP is still pending when deferred', async () => {
    let resolveLcpWindow: () => void = () => undefined;
    mocks.waitForLcpWindowEnd.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        resolveLcpWindow = () => resolve(undefined);
      })
    );
    render(<DeferredHarness />);

    expect(screen.getByText('idle')).toBeInTheDocument();

    await act(async () => {
      fireEvent.pointerDown(window);
      await Promise.resolve();
    });

    expect(screen.getByText('active')).toBeInTheDocument();
    resolveLcpWindow();
  });
});
