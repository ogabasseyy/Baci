import { initializeChunkLoadRecovery } from '@/lib/chunk-load-recovery';
import { logger } from '@/lib/logger';
import { getPostHogBrowserEnv } from '@/lib/posthog/config';
import { isPublicBlogPathname } from '@/lib/posthog/public-blog-path';

type NextBeforeInteractiveEntry = [
  string | 0 | null,
  Record<string, unknown> | undefined,
];

const POST_PAINT_HYDRATION_DELAY_MS = 48;

function scheduleAfterFirstPaint(resolve: () => void): void {
  const settleAfterPaint = () => {
    window.setTimeout(resolve, POST_PAINT_HYDRATION_DELAY_MS);
  };

  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(settleAfterPaint);
    return;
  }

  settleAfterPaint();
}

export function registerPostPaintHydrationGate(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const globalScope = globalThis as typeof globalThis & {
    __next_s?: NextBeforeInteractiveEntry[];
  };
  if (Array.isArray(globalScope.__next_s) && globalScope.__next_s.length > 0) {
    return;
  }

  const queue: NextBeforeInteractiveEntry[] = [[null, undefined]];
  Object.defineProperty(queue, 'reduce', {
    configurable: true,
    value(
      _callback: unknown,
      initialValue: Promise<unknown> = Promise.resolve()
    ) {
      queue.length = 0;
      delete (queue as { reduce?: unknown }).reduce;
      return Promise.resolve(initialValue).then(
        () =>
          new Promise<void>((resolve) => {
            scheduleAfterFirstPaint(resolve);
          })
      );
    },
  });
  globalScope.__next_s = queue;
}

const postHogBrowserEnv = getPostHogBrowserEnv();

// Chunk-load recovery must stay eager at module scope so it can catch early
// dynamic-import failures (stale /_next/static after a deploy) before hydration.
// It is intentionally NOT deferred.
initializeChunkLoadRecovery();
registerPostPaintHydrationGate();

async function initializePostHogInstrumentation() {
  try {
    const { capturePostHogPageview, initializePostHogBrowser } = await import(
      '@/lib/posthog/browser'
    );

    initializePostHogBrowser(postHogBrowserEnv);
    capturePostHogPageview();
  } catch (error) {
    logger.warn({
      error,
      message: 'PostHog browser instrumentation failed to initialize.',
    });
  }
}

let postHogInstrumentationInitialized = false;

export function initializePostHogInstrumentationIfAllowed(
  pathname = globalThis.location?.pathname
) {
  if (
    typeof window === 'undefined' ||
    postHogInstrumentationInitialized ||
    isPublicBlogPathname(pathname)
  ) {
    return;
  }

  postHogInstrumentationInitialized = true;
  void initializePostHogInstrumentation();
}

// The deferred idle boot is NOT armed here. PostHogClientBootstrap
// (rendered by RootDynamicBody in the root layout, so mounted on every
// PostHog-eligible route) is the single owner of the idle-gated boot: it
// schedules exactly one scheduleIdleBoot and, unlike this module's former
// module-scope boot, is pathname-aware (public-blog lightweight mode, pathname
// reconfigure, first-interaction fast path) and calls this
// `initializePostHogInstrumentationIfAllowed`. Arming a second boot here raced
// the component and churned idle listeners for no benefit (init is idempotent),
// so this file now only owns eager chunk-load recovery and the exported gate.
