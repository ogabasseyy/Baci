/**
 * Resolves once the page's LCP window ends — LCP candidates settle (no new
 * candidate for `quietMs`) AND the page lifecycle reaches `load`, the
 * shopper interacts (`pointerdown` / `keydown`), or a timeout elapses — so
 * heavy post-load work can wait out the LCP window instead of competing
 * with it for bandwidth and main thread.
 *
 * Settling (not first candidate) matters because LCP observers keep emitting
 * larger candidates until interaction or page hiding: on a slow page the
 * first callback is often an early text or placeholder paint while the hero
 * image is still downloading. Resolving on it would start the deferred work
 * while the eventual hero LCP is still loading. Each new candidate restarts
 * the quiet window, so resolution tracks the last paint, not the first.
 *
 * The quiet gap alone is still not finality: on a throttled load the hero
 * image can take well over the gap to follow an early text candidate, with
 * nothing left to restart the timer while it downloads. The `load` half of
 * the settle condition covers that — the browser fires it only once the
 * initial document's resources (including a server-rendered hero image)
 * finish, the closest thing to a definitive page-lifecycle LCP boundary.
 * Either half alone never resolves: both must hold, or the
 * interaction/timeout escapes fire.
 *
 * The interaction arm matters because the idle scheduler that precedes this
 * wait settles and detaches its own listeners first: without it, a click
 * landing mid-wait would stall analytics boot until LCP or the backstop,
 * losing the click and delaying autocapture. An already-engaged shopper
 * ends the wait immediately.
 *
 * Uses a buffered PerformanceObserver, so candidates that already fired are
 * delivered into the same settle logic. Never rejects: an unsupported
 * observer, a missing Performance API, or the timeout all resolve, because
 * booting late must degrade to booting, never to never.
 */
const LCP_WINDOW_TIMEOUT_MS = 5000;

// Inter-candidate gap that marks LCP as settled. Hero candidates on slow
// connections can arrive hundreds of milliseconds apart (text paint, then
// the image); 500ms covers typical gaps while keeping the added post-LCP
// delay bounded. The absolute timeout above still caps the total wait.
const LCP_QUIET_WINDOW_MS = 500;

export function waitForLcpWindowEnd(
  timeoutMs: number = LCP_WINDOW_TIMEOUT_MS,
  quietMs: number = LCP_QUIET_WINDOW_MS
): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    let observer: PerformanceObserver | undefined;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    // The load half of the settle condition. Reads the live readyState so
    // a wait that starts after `load` degrades to the quiet-only path.
    let pageLoaded =
      typeof document !== 'undefined' && document.readyState === 'complete';
    let quietElapsed = false;
    const timer = setTimeout(done, timeoutMs);

    function done() {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (quietTimer !== undefined) {
        clearTimeout(quietTimer);
      }
      try {
        observer?.disconnect();
      } catch {
        // Ignore disconnect errors; the wait itself is over.
      }
      window.removeEventListener('pointerdown', done);
      window.removeEventListener('keydown', done);
      window.removeEventListener('load', onPageLoad);
      resolve();
    }

    // Settle needs BOTH halves: candidates quiet AND the page lifecycle at
    // `load`. Whichever half arrives last resolves the wait.
    function trySettle() {
      if (!settled && quietElapsed && pageLoaded) {
        done();
      }
    }

    function onQuietElapsed() {
      quietElapsed = true;
      trySettle();
    }

    function onPageLoad() {
      pageLoaded = true;
      trySettle();
    }

    // A candidate arrived: the final LCP may still be loading, so restart
    // the quiet window instead of resolving on this paint.
    function onLcpCandidate() {
      if (settled) {
        return;
      }
      quietElapsed = false;
      if (quietTimer !== undefined) {
        clearTimeout(quietTimer);
      }
      quietTimer = setTimeout(onQuietElapsed, quietMs);
    }

    window.addEventListener('pointerdown', done, {
      once: true,
      passive: true,
    });
    window.addEventListener('keydown', done, { once: true });
    window.addEventListener('load', onPageLoad, { once: true });

    try {
      observer = new PerformanceObserver(() => {
        onLcpCandidate();
      });
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      done();
    }
  });
}
