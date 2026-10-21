'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { logger } from '@/lib/logger';
import { hasPostHogBrowserInitialized } from '@/lib/posthog/browser-state';
import { isPublicBlogPathname } from '@/lib/posthog/public-blog-path';

function PostHogPageviewSearchObserver({
  pathname,
}: {
  pathname: string | null;
}) {
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
          const [{ capturePublicBlogPageview }, { getPostHogBrowserEnv }] =
            await Promise.all([
              import('@/lib/posthog/public-blog-pageview'),
              import('@/lib/posthog/config'),
            ]);
          if (!cancelled) {
            capturePublicBlogPageview(getPostHogBrowserEnv(), currentUrl);
          }
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

        const [
          { resetPublicBlogPageviewDedupe },
          { getPostHogBrowserEnv },
          { capturePostHogPageview, initializePostHogBrowser },
        ] = await Promise.all([
          import('@/lib/posthog/public-blog-pageview'),
          import('@/lib/posthog/config'),
          import('@/lib/posthog/browser'),
        ]);

        if (cancelled) {
          return;
        }

        if (!isPublicBlog) {
          resetPublicBlogPageviewDedupe();
        }

        // PostHog is already initialized here, so this only reconfigures the
        // live client for the current surface's lightweight mode (a no-op
        // re-init that calls set_config); it never calls posthog.init().
        initializePostHogBrowser(getPostHogBrowserEnv(), console, {
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

    void capturePageview();

    return () => {
      cancelled = true;
    };
  }, [pathname, searchParamString]);

  return null;
}

export function PostHogPageviewTracker() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return <PostHogPageviewSearchObserver pathname={pathname} />;
}
