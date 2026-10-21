'use client';

import { isChunkRecoveryReloadPending } from '@/lib/chunk-load-recovery';
import { detectChunkFailureFromValue } from '@/lib/chunk-load-recovery/chunk-failure-detection';
import { sanitizePostHogException } from '@/lib/posthog/exception-sanitizer';
import { pendingClientExceptionQueue } from '@/lib/posthog/pending-client-exception-queue';
import { loadPostHogBrowserSdk } from '@/lib/posthog/posthog-sdk-loader';
import { sanitizePostHogProperties } from '@/lib/posthog/property-sanitizer';

/**
 * Reports a handled browser exception to PostHog.
 *
 * The `posthog-js` browser SDK (~75 KB gzipped) is loaded LAZILY here via a
 * dynamic `import('posthog-js')` rather than a top-level import. This module is
 * statically imported by every `error.tsx` boundary (through
 * `useBoundaryErrorReport`), and error-boundary client modules ship in each
 * route's INITIAL client bundle so the boundary can render if a client error
 * throws. A top-level `import posthog from 'posthog-js'` therefore pulled the
 * full SDK onto the home boot path (measured in the LCP window at ~878ms on
 * ogabassey.com) even though PostHog init is otherwise idle-deferred by
 * `PostHogClientBootstrap` / `scheduleIdleBoot`. Deferring the import to the
 * moment an exception is actually captured keeps the SDK chunk out of the eager
 * home graph. The dynamic import resolves from module cache once the idle boot
 * has already loaded posthog-js through `lib/posthog/browser.ts`, so the common
 * case adds no extra network cost.
 *
 * The return value reports whether capture was *attempted* (token present); the
 * actual capture completes asynchronously after the SDK chunk resolves. Error
 * and property sanitization runs synchronously at call time so the captured
 * payload reflects the caller's exact context, not a later frame.
 */
export function captureClientException(
  error: unknown,
  properties?: Record<string, unknown>
): boolean {
  if (!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) {
    return false;
  }

  const sanitizedError = sanitizePostHogException(error);
  // Stamp the failing page's URL/pathname SYNCHRONOUSLY, before the deferred
  // SDK import: posthog-js derives `$current_url`/`$pathname` at capture
  // time, so an error-boundary reset, navigation or chunk-recovery reload
  // racing the import would attribute the exception to the LATER page (same
  // convention as `withOriginUrl` in web-vitals-queue.ts). Stamped after the
  // caller spread so, like `app_surface`/`runtime`, callers cannot spoof it;
  // the URL property sanitizer redacts the query/hash.
  const location = globalThis.location;
  const sanitizedProperties = sanitizePostHogProperties({
    ...properties,
    ...(location
      ? { $current_url: location.href, $pathname: location.pathname }
      : {}),
    app_surface: 'web',
    runtime: 'browser',
  });

  const isChunkFailure = detectChunkFailureFromValue(error) !== null;

  if (isChunkFailure && isChunkRecoveryReloadPending()) {
    // Recovery already emitted its boot-free `chunk_load_recovery` beacon and
    // is navigating. The normal before_send chain intentionally drops this
    // duplicate exception while reload is pending, so do not start an SDK
    // chunk request that the unload will cancel.
    return true;
  }

  // A declined/exhausted chunk recovery must remain visible even when the same
  // stale deployment prevents the posthog-js chunk from loading. Persist only
  // these chunk failures; normal handled exceptions retain the lightweight
  // best-effort dynamic-import path.
  let queuedExceptionId: string | undefined;
  if (isChunkFailure) {
    try {
      queuedExceptionId = pendingClientExceptionQueue.enqueue(
        sanitizedError,
        sanitizedProperties
      );
    } catch {
      // Persistence must never escape the best-effort error-reporting path.
    }
  }

  void loadPostHogBrowserSdk()
    .then(({ default: posthog }) => {
      const queuedException = queuedExceptionId
        ? pendingClientExceptionQueue.take(queuedExceptionId)
        : undefined;

      // The idle browser initializer may have atomically drained this entry
      // while the direct dynamic import was resolving. In that case it owns
      // capture, preventing a duplicate exception.
      if (queuedExceptionId && !queuedException) {
        return;
      }

      try {
        posthog.captureException(
          queuedException?.error ?? sanitizedError,
          queuedException?.properties ?? sanitizedProperties
        );
      } catch {
        if (queuedException) {
          pendingClientExceptionQueue.restore(queuedException);
        }
      }
    })
    .catch(() => {
      // Declined chunk failures remain in the session-backed queue for the next
      // successful browser init. Other handled exceptions stay best-effort.
    });

  return true;
}
