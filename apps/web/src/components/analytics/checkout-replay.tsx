'use client';

import { usePathname } from 'next/navigation';
import { useLayoutEffect } from 'react';
import { getPostHogBrowserEnv } from '@/lib/posthog/config';
import { waitForLcpWindowEnd } from '@/lib/posthog/wait-for-lcp';

function isCheckoutPath(pathname: string) {
  return /^\/(?:ogabassey\/)?checkout\/?$/.test(pathname);
}

function isSampledCheckoutSession(sessionId: string) {
  // PostHog session IDs are UUIDs. Sample using their random suffix so the
  // unsampled 99% never load the recorder, including after a page reload.
  const suffix = /[\da-f]{8}$/i.exec(sessionId)?.[0];
  return suffix !== undefined && Number.parseInt(suffix, 16) < 2 ** 32 / 100;
}

export function CheckoutReplay({
  enabled = process.env.NEXT_PUBLIC_CHECKOUT_REPLAY_ENABLED === 'true',
}: {
  enabled?: boolean;
}) {
  const pathname = usePathname();

  useLayoutEffect(() => {
    const env = getPostHogBrowserEnv();
    if (
      !enabled ||
      !pathname ||
      !isCheckoutPath(pathname) ||
      !env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim()
    )
      return;

    let cancelled = false;
    let stopRecording: (() => void) | undefined;
    function isCurrentCheckout() {
      return (
        !cancelled &&
        isCheckoutPath(window.location.pathname) &&
        !new URLSearchParams(window.location.search).has('oxygenOrderId') &&
        !new URLSearchParams(window.location.search).has('orderId')
      );
    }

    async function startAfterPaint() {
      await waitForLcpWindowEnd();
      if (!isCurrentCheckout()) return;
      const [{ initializePostHogBrowser }, { default: posthog }] =
        await Promise.all([
          import('@/lib/posthog/browser'),
          import('posthog-js'),
        ]);
      if (!isCurrentCheckout()) return;

      initializePostHogBrowser(env, console, { pathname });
      if (!isSampledCheckoutSession(posthog.get_session_id())) return;
      stopRecording = () => posthog.stopSessionRecording();
      // Sampling already happened above. Other project controls still apply.
      posthog.startSessionRecording({ sampling: true });
    }

    void startAfterPaint().catch(() => {
      stopRecording?.();
    });
    return () => {
      cancelled = true;
      stopRecording?.();
    };
  }, [enabled, pathname]);

  return null;
}
