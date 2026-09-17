/**
 * Resolves once the page's first Largest Contentful Paint candidate has been
 * observed (or a timeout elapses), so heavy post-load work can wait out the
 * LCP window instead of competing with it for bandwidth and main thread.
 *
 * Uses a buffered PerformanceObserver, so a candidate that already fired is
 * still delivered. Never rejects: an unsupported observer, a missing
 * Performance API, or the timeout all resolve, because booting late must
 * degrade to booting, never to never.
 */
const FIRST_LCP_TIMEOUT_MS = 5000;

export function waitForFirstLcpCandidate(
  timeoutMs: number = FIRST_LCP_TIMEOUT_MS
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
      resolve();
    }

    try {
      observer = new PerformanceObserver(() => done());
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      done();
    }
  });
}
