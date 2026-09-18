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

  it('waits out the quiet window after a candidate instead of resolving on first paint', async () => {
    // Regression test: the first LCP callback is often an early text or
    // placeholder paint while the hero image is still downloading. Resolving
    // on it would start deferred work mid-LCP; the wait must hold until
    // candidates settle.
    vi.useFakeTimers();
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

    let resolved = false;
    const pending = waitForLcpWindowEnd(5000, 500).then(() => {
      resolved = true;
    });
    expect(deliveredCallbacks).toHaveLength(1);
    deliveredCallbacks[0]?.();

    await vi.advanceTimersByTimeAsync(499);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(resolved).toBe(true);
    expect(disconnect).toHaveBeenCalled();
  });

  it('restarts the quiet window when a larger candidate arrives', async () => {
    vi.useFakeTimers();
    const deliveredCallbacks: Array<() => void> = [];
    function FakePerformanceObserver(callback: () => void) {
      deliveredCallbacks.push(callback);
    }
    FakePerformanceObserver.prototype.observe = vi.fn();
    FakePerformanceObserver.prototype.disconnect = vi.fn();
    Object.defineProperty(globalThis, 'PerformanceObserver', {
      value: FakePerformanceObserver,
      writable: true,
      configurable: true,
    });

    let resolved = false;
    const pending = waitForLcpWindowEnd(5000, 500).then(() => {
      resolved = true;
    });
    deliveredCallbacks[0]?.();

    // A second candidate 400ms later (hero image after text paint) restarts
    // the window: 499ms after the first paint must still be pending.
    await vi.advanceTimersByTimeAsync(400);
    deliveredCallbacks[0]?.();
    await vi.advanceTimersByTimeAsync(499);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(resolved).toBe(true);
  });

  it('delivers already-fired candidates through the buffered observer', async () => {
    // Candidates painted before the wait starts arrive via buffered
    // delivery and enter the same settle logic — never an instant resolve.
    vi.useFakeTimers();
    const deliveredCallbacks: Array<() => void> = [];
    function FakePerformanceObserver(callback: () => void) {
      deliveredCallbacks.push(callback);
      // Simulate buffered redelivery on observe: the pre-existing candidate
      // is reported asynchronously, like the real observer.
      queueMicrotask(callback);
    }
    FakePerformanceObserver.prototype.observe = vi.fn();
    FakePerformanceObserver.prototype.disconnect = vi.fn();
    Object.defineProperty(globalThis, 'PerformanceObserver', {
      value: FakePerformanceObserver,
      writable: true,
      configurable: true,
    });

    let resolved = false;
    const pending = waitForLcpWindowEnd(5000, 500).then(() => {
      resolved = true;
    });
    // Flush the buffered redelivery, then hold for the quiet window.
    await vi.advanceTimersByTimeAsync(0);
    expect(deliveredCallbacks).toHaveLength(1);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(resolved).toBe(true);
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
