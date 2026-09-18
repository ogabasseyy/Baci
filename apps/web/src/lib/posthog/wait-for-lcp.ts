/**
 * Resolves once the page's LCP window ends — the first Largest Contentful
 * Paint candidate is observed, the shopper interacts (`pointerdown` /
 * `keydown`), or a timeout elapses — so heavy post-load work can wait out
 * the LCP window instead of competing with it for bandwidth and main thread.
 *
 * The interaction arm matters because the idle scheduler that precedes this
 * wait settles and detaches its own listeners first: without it, a click
 * landing mid-wait would stall analytics boot until LCP or the backstop,
 * losing the click and delaying autocapture. An already-engaged shopper
 * ends the wait immediately.
 *
 * Uses a buffered PerformanceObserver, so a candidate that already fired is
 * still delivered. Never rejects: an unsupported observer, a missing
 * Performance API, or the timeout all resolve, because booting late must
 * degrade to booting, never to never.
 */
const LCP_WINDOW_TIMEOUT_MS = 5000;

export function waitForLcpWindowEnd(
  timeoutMs: number = LCP_WINDOW_TIMEOUT_MS
): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }

  try {
    const existing = window.performance?.getEntriesByType(
      'largest-contentful-paint'
    );
    if (existing && existing.length > 0) {
      return Promise.resolve();
    }
  } catch {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    let observer: PerformanceObserver | undefined;
    const timer = setTimeout(done, timeoutMs);

    function done() {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        observer?.disconnect();
      } catch {
        // Ignore disconnect errors; the wait itself is over.
      }
      window.removeEventListener('pointerdown', done);
      window.removeEventListener('keydown', done);
      resolve();
    }

    window.addEventListener('pointerdown', done, {
      once: true,
      passive: true,
    });
    window.addEventListener('keydown', done, { once: true });

    try {
      observer = new PerformanceObserver(() => done());
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      done();
    }
  });
}
