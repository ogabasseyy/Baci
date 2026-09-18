'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { logger } from '@/lib/logger';
import { hasPostHogBrowserInitialized } from '@/lib/posthog/browser-state';
import { getPostHogBrowserEnv } from '@/lib/posthog/config';
import { isPublicBlogPathname } from '@/lib/posthog/public-blog-path';
import {
  type IdleBootReason,
  scheduleIdleBoot,
} from '@/lib/posthog/schedule-idle-boot';
import { waitForLcpWindowEnd } from '@/lib/posthog/wait-for-lcp';

const postHogBrowserEnv = getPostHogBrowserEnv();

/**
 * Boot the browser PostHog client for `currentPathname`. On a public blog path
 * it stays off the full client unless PostHog was already booted elsewhere,
 * keeping the blog critical path free of instrumentation. `isCancelled` lets an
 * in-flight boot abort if the component unmounts between the dynamic imports.
 */
async function bootPostHogForPathname(
  currentPathname: string,
  isCancelled: () => boolean,
  idleReason?: IdleBootReason,
  getCurrentPathname: () => string | undefined = () => currentPathname
): Promise<void> {
  const isPublicBlog = isPublicBlogPathname(currentPathname, {
    hostname: globalThis.location?.hostname,
  });

  if (isPublicBlog && !hasPostHogBrowserInitialized()) {
    return;
  }

  try {
    // Keep the 76KB client (plus its transitive chunks) out of the LCP
    // window: boot once the first LCP candidate has painted, the shopper
    // interacts, or the backstop elapses. Pre-boot metrics are buffered by
    // the web-vitals queue, so nothing is lost — it just flushes after boot.
    //
    // Exception: when the idle gate fired on an early interaction, the
    // shopper is already engaging — waiting would install autocapture too
    // late and lose the follow-up clicks (user events are NOT buffered,
    // only web-vitals are). Boot immediately instead; the triggering
    // interaction usually lands after LCP anyway.
    if (idleReason !== 'interaction') {
      await waitForLcpWindowEnd();
    }
    if (isCancelled()) {
      return;
    }

    // The LCP wait is async: a navigation may have landed on a different
    // route while it pended. Re-resolve so a stale non-blog capture can't
    // initialize the full client on a public blog destination (or attribute
    // the boot to the wrong route).
    const pathname = getCurrentPathname() ?? currentPathname;
    const resolvedPublicBlog = isPublicBlogPathname(pathname, {
      hostname: globalThis.location?.hostname,
    });
    if (resolvedPublicBlog && !hasPostHogBrowserInitialized()) {
      return;
    }

    const { initializePostHogBrowser } = await import('@/lib/posthog/browser');

    if (isCancelled()) {
      return;
    }

    // The chunk load is async: a navigation may have landed on a public
    // blog while it pended. Re-resolve again so the stale invocation can't
    // initialize the full client for the old route after the blog's own
    // effect already stood down.
    const postImportPathname = getCurrentPathname() ?? pathname;
    const postImportPublicBlog = isPublicBlogPathname(postImportPathname, {
      hostname: globalThis.location?.hostname,
    });
    if (postImportPublicBlog && !hasPostHogBrowserInitialized()) {
      return;
    }

    initializePostHogBrowser(postHogBrowserEnv, console, {
      lightweight: postImportPublicBlog,
      pathname: postImportPathname,
      hostname: globalThis.location?.hostname,
    });

    if (postImportPublicBlog) {
      return;
    }

    const { initializePostHogInstrumentationIfAllowed } = await import(
      '@/instrumentation-client'
    );

    if (isCancelled()) {
      return;
    }

    // Attribute instrumentation to the latest route, never a stale one —
    // and stay off it entirely when the latest route is a public blog.
    const finalPathname = getCurrentPathname() ?? postImportPathname;
    if (
      !isPublicBlogPathname(finalPathname, {
        hostname: globalThis.location?.hostname,
      })
    ) {
      initializePostHogInstrumentationIfAllowed(finalPathname);
    }
  } catch (error) {
    if (!isCancelled()) {
      logger.warn({
        error,
        message: 'PostHog client bootstrap failed to initialize.',
      });
    }
  }
}

export function PostHogClientBootstrap() {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const hasIdledRef = useRef(false);
  const cancelledRef = useRef(false);

  // Schedule the deferred idle boot exactly ONCE on mount. Previously this
  // effect was keyed on the pathname, so every client navigation cancelled and
  // rescheduled the idle listeners — listener churn that also delayed the boot
  // under rapid navigation. The idle gate still boots on the first idle period,
  // window load, first interaction, or a hard timeout, so instrumentation never
  // blocks first paint. The boot reads the latest pathname from a ref, so it
  // never needs to be a dependency here.
  useEffect(() => {
    cancelledRef.current = false;
    const isCancelled = () => cancelledRef.current;

    const cancelIdleBoot = scheduleIdleBoot((reason) => {
      hasIdledRef.current = true;
      const currentPathname =
        pathnameRef.current ?? globalThis.location?.pathname;
      if (!isCancelled() && currentPathname) {
        void bootPostHogForPathname(
          currentPathname,
          isCancelled,
          reason,
          () => pathnameRef.current ?? globalThis.location?.pathname
        );
      }
    });

    return () => {
      cancelledRef.current = true;
      cancelIdleBoot();
    };
  }, []);

  // Pathname-dependent boot, split out of the scheduling effect above. Once the
  // idle gate has elapsed, a client navigation (e.g. blog -> non-blog) can boot
  // immediately without re-arming the idle scheduler; before it elapses the
  // mount-once effect owns the single boot for the current pathname.
  useEffect(() => {
    pathnameRef.current = pathname;
    if (!hasIdledRef.current) {
      return;
    }
    const currentPathname = pathname ?? globalThis.location?.pathname;
    if (currentPathname) {
      void bootPostHogForPathname(currentPathname, () => cancelledRef.current);
    }
  }, [pathname]);

  return null;
}
