import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForLcpWindowEnd } from './wait-for-lcp';

describe('waitForLcpWindowEnd', () => {
  const realPerformanceObserver = globalThis.PerformanceObserver;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'PerformanceObserver', {
      value: realPerformanceObserver,
      writable: true,
      configurable: true,
    });
  });

  it('resolves immediately when an LCP candidate already exists', async () => {
    const getEntriesByType = vi.fn().mockReturnValue([{ startTime: 123 }]);
    Object.defineProperty(window, 'performance', {
      value: { getEntriesByType },
      writable: true,
      configurable: true,
    });

    await expect(waitForLcpWindowEnd(10)).resolves.toBeUndefined();
    expect(getEntriesByType).toHaveBeenCalledWith('largest-contentful-paint');
  });

  it('resolves when the observer delivers a candidate', async () => {
    Object.defineProperty(window, 'performance', {
      value: { getEntriesByType: vi.fn().mockReturnValue([]) },
      writable: true,
      configurable: true,
    });

    const deliveredCallbacks: Array<() => void> = [];
    const disconnect = vi.fn();
    function FakePerformanceObserver(callback: () => void) {
      deliveredCallbacks.push(callback);
    }
    FakePerformanceObserver.prototype.observe = vi.fn();
    FakePerformanceObserver.prototype.disconnect = disconnect;
    Object.defineProperty(globalThis, 'PerformanceObserver', {
      value: FakePerformanceObserver,
      writable: true,
      configurable: true,
    });

    const pending = waitForLcpWindowEnd(5000);
    expect(deliveredCallbacks).toHaveLength(1);
    deliveredCallbacks[0]?.();

    await expect(pending).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalled();
  });

  it('resolves at the timeout backstop when LCP never fires', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'performance', {
      value: { getEntriesByType: vi.fn().mockReturnValue([]) },
      writable: true,
      configurable: true,
    });
    function FakePerformanceObserver() {}
    FakePerformanceObserver.prototype.observe = vi.fn();
    FakePerformanceObserver.prototype.disconnect = vi.fn();
    Object.defineProperty(globalThis, 'PerformanceObserver', {
      value: FakePerformanceObserver,
      writable: true,
      configurable: true,
    });

    const pending = waitForLcpWindowEnd(100);
    const assertion = expect(pending).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it('resolves instead of throwing when the observer is unsupported', async () => {
    Object.defineProperty(window, 'performance', {
      value: { getEntriesByType: vi.fn().mockReturnValue([]) },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'PerformanceObserver', {
      value: function UnsupportedPerformanceObserver() {
        throw new Error('not supported');
      },
      writable: true,
      configurable: true,
    });

    await expect(waitForLcpWindowEnd(5000)).resolves.toBeUndefined();
  });

  it('resolves early on the first interaction while LCP is still pending', async () => {
    // The idle scheduler settles before this wait begins, so a click landing
    // mid-wait must end the wait itself — otherwise analytics boot stalls
    // until LCP or the backstop and the click is lost.
    vi.useFakeTimers();
    Object.defineProperty(window, 'performance', {
      value: { getEntriesByType: vi.fn().mockReturnValue([]) },
      writable: true,
      configurable: true,
    });
    const disconnect = vi.fn();
    function FakePerformanceObserver() {}
    FakePerformanceObserver.prototype.observe = vi.fn();
    FakePerformanceObserver.prototype.disconnect = disconnect;
    Object.defineProperty(globalThis, 'PerformanceObserver', {
      value: FakePerformanceObserver,
      writable: true,
      configurable: true,
    });

    const pending = waitForLcpWindowEnd(5000);
    const assertion = expect(pending).resolves.toBeUndefined();
    window.dispatchEvent(new Event('pointerdown'));
    await assertion;
    expect(disconnect).toHaveBeenCalled();
  });

  it('resolves early on the first keydown while LCP is still pending', async () => {
    Object.defineProperty(window, 'performance', {
      value: { getEntriesByType: vi.fn().mockReturnValue([]) },
      writable: true,
      configurable: true,
    });
    function FakePerformanceObserver() {}
    FakePerformanceObserver.prototype.observe = vi.fn();
    FakePerformanceObserver.prototype.disconnect = vi.fn();
    Object.defineProperty(globalThis, 'PerformanceObserver', {
      value: FakePerformanceObserver,
      writable: true,
      configurable: true,
    });

    const pending = waitForLcpWindowEnd(5000);
    const assertion = expect(pending).resolves.toBeUndefined();
    window.dispatchEvent(new Event('keydown'));
    await assertion;
  });
});
