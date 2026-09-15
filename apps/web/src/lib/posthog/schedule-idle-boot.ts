const DEFAULT_IDLE_BOOT_TIMEOUT_MS = 4000;
const FIRST_INTERACTION_EVENTS = ['pointerdown', 'keydown'] as const;
const PRERENDERING_CHANGE_EVENT = 'prerenderingchange';

/**
 * Reads `document.prerendering` (Speculation Rules / Cloudflare Speed Brain
 * prerender flag) safely. The property is not in the standard DOM lib types and
 * is absent in SSR and older browsers — a missing property is treated as "not
 * prerendering" so the normal gate arms immediately.
 */
function isDocumentPrerendering(): boolean {
  return (
    typeof document !== 'undefined' &&
    (document as Document & { prerendering?: boolean }).prerendering === true
  );
}

export interface ScheduleIdleBootOptions {
  /**
   * Hard upper bound (ms) after which the callback runs even if the browser
   * never reports an idle period or the user never interacts.
   * @default 4000
   */
  timeoutMs?: number;
}

/**
 * Runs `callback` exactly once, deferred off the initial critical path, on the
 * earliest of:
 * - a browser idle period (`requestIdleCallback`, itself bounded by `timeoutMs`),
 * - the window `load` event (which then schedules the idle activation),
 * - the first user interaction (`pointerdown` / `keydown`, so an early click
 *   boots instrumentation promptly instead of waiting for idle), or
 * - the `timeoutMs` hard fallback.
 *
 * This keeps expensive analytics work (PostHog init: session recording,
 * heatmaps, autocapture, dead-click capture) off the initial critical path
 * without missing an early interaction.
 *
 * While the document is being speculatively prerendered
 * (`document.prerendering === true`, e.g. Cloudflare Speed Brain), the gate is
 * NOT armed: booting there would inflate pageviews/recordings for prerenders the
 * user may never activate. The gate arms on the `prerenderingchange` activation
 * event instead. A prerender that is discarded never fires the event, so the
 * callback never runs (and any web-vitals it buffered never flush).
 *
 * SSR-safe: when there is no `window`, it returns a no-op canceller and never
 * invokes `callback`. Returns a canceller that stops any pending boot and
 * detaches all listeners; calling it after the callback already ran is a no-op.
 */
export function scheduleIdleBoot(
  callback: () => void,
  { timeoutMs = DEFAULT_IDLE_BOOT_TIMEOUT_MS }: ScheduleIdleBootOptions = {}
): () => void {
  if (typeof window === 'undefined') {
    return () => {
      // No browser environment: nothing was scheduled.
    };
  }

  let settled = false;
  let armed = false;
  let timeoutId: number | undefined;
  let idleCallbackId: number | undefined;

  function teardown(): void {
    document.removeEventListener(
      PRERENDERING_CHANGE_EVENT,
      handlePrerenderingChange
    );

    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      timeoutId = undefined;
    }

    if (idleCallbackId !== undefined) {
      if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleCallbackId);
      } else {
        window.clearTimeout(idleCallbackId);
      }
      idleCallbackId = undefined;
    }

    window.removeEventListener('load', handleWindowLoad);

    for (const eventName of FIRST_INTERACTION_EVENTS) {
      window.removeEventListener(eventName, run);
    }
  }

  function run(): void {
    if (settled) {
      return;
    }

    settled = true;
    teardown();
    callback();
  }

  function cancel(): void {
    if (settled) {
      return;
    }

    settled = true;
    teardown();
  }

  function scheduleIdle(): void {
    if (settled || idleCallbackId !== undefined) {
      return;
    }

    if (typeof window.requestIdleCallback === 'function') {
      idleCallbackId = window.requestIdleCallback(run, {
        timeout: timeoutMs > 0 ? timeoutMs : 1000,
      });
      return;
    }

    idleCallbackId = window.setTimeout(run, 0);
  }

  function handleWindowLoad(): void {
    scheduleIdle();
  }

  function armIdleGate(): void {
    if (settled || armed) {
      return;
    }

    armed = true;

    if (timeoutMs > 0) {
      timeoutId = window.setTimeout(run, timeoutMs);
    }

    for (const eventName of FIRST_INTERACTION_EVENTS) {
      window.addEventListener(eventName, run, { once: true, passive: true });
    }

    if (document.readyState === 'complete') {
      scheduleIdle();
    } else {
      window.addEventListener('load', handleWindowLoad, { once: true });
    }
  }

  function handlePrerenderingChange(): void {
    if (settled || isDocumentPrerendering()) {
      return;
    }

    armIdleGate();
  }

  if (isDocumentPrerendering()) {
    document.addEventListener(
      PRERENDERING_CHANGE_EVENT,
      handlePrerenderingChange,
      { once: true }
    );
  } else {
    armIdleGate();
  }

  return cancel;
}

export { DEFAULT_IDLE_BOOT_TIMEOUT_MS };
