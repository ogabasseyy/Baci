'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { logger } from '@/lib/logger';
import { hasPostHogBrowserInitialized } from '@/lib/posthog/browser-state';
import { getPostHogBrowserEnv } from '@/lib/posthog/config';
import {
  capturePublicBlogPageview,
  resetPublicBlogPageviewDedupe,
} from '@/lib/posthog/public-blog-pageview';
import { isPublicBlogPathname } from '@/lib/posthog/public-blog-path';

const postHogBrowserEnv = getPostHogBrowserEnv();

export function PostHogPageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamString = searchParams?.toString() ?? '';

  useEffect(() => {
    const currentPathname = pathname ?? globalThis.location?.pathname;

    if (!currentPathname) {
      return;
    }

    const currentSearch = searchParamString ? `?${searchParamString}` : '';
    const currentUrl =
      typeof globalThis.location !== 'undefined'
        ? globalThis.location.href
        : `${currentPathname}${currentSearch}`;
    const hostname = globalThis.location?.hostname;
    let cancelled = false;

    async function capturePageview() {
      try {
        const isPublicBlog = isPublicBlogPathname(currentPathname, {
          hostname,
        });

        if (isPublicBlog && !hasPostHogBrowserInitialized()) {
          capturePublicBlogPageview(postHogBrowserEnv, currentUrl);
          return;
        }

        // The tracker must NEVER boot PostHog: the idle-gated
        // instrumentation-client owns the posthog-js chunk download AND the
        // full-client boot (session recording, autocapture, heatmaps) so they
        // stay off the initial critical path. Before that boot fires this
        // tracker is a no-op for non-blog routes — it does not import the
        // posthog-js chunk and does not capture. The landing pageview is
        // covered exactly-once by the idle boot's own capturePostHogPageview()
        // (capture_pageview is false, so posthog-js adds no duplicate view).
        if (!hasPostHogBrowserInitialized()) {
          return;
        }

        if (!isPublicBlog) {
          resetPublicBlogPageviewDedupe();
        }

        const { capturePostHogPageview, initializePostHogBrowser } =
          await import('@/lib/posthog/browser');

        if (cancelled) {
          return;
        }

        // PostHog is already initialized here, so this only reconfigures the
        // live client for the current surface's lightweight mode (a no-op
        // re-init that calls set_config); it never calls posthog.init().
        initializePostHogBrowser(postHogBrowserEnv, console, {
          lightweight: isPublicBlog,
          pathname: currentPathname,
          hostname,
        });

        capturePostHogPageview(currentUrl);
      } catch (error) {
        if (!cancelled) {
          logger.warn({
            error,
            message: 'PostHog pageview capture failed.',
          });
        }
      }
    }

    function captureAfterConsentChange() {
      if (
        isPublicBlogPathname(currentPathname, { hostname }) &&
        !hasPostHogBrowserInitialized()
      ) {
        void capturePageview();
      }
    }

    window.addEventListener(
      'cookie-consent-updated',
      captureAfterConsentChange
    );
    void capturePageview();

    return () => {
      cancelled = true;
      window.removeEventListener(
        'cookie-consent-updated',
        captureAfterConsentChange
      );
    };
  }, [pathname, searchParamString]);

  return null;
}
