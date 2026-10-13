'use client';

import { useEffect, useRef, useState } from 'react';
import { waitForLcpWindowEnd } from '@/lib/posthog/wait-for-lcp';

interface UseViewportActivationOptions {
  enabled?: boolean;
  rootMargin?: string;
  threshold?: number;
  timeoutMs?: number;
  /**
   * Hold intersection AND backstop activation until the LCP window ends.
   * For gates that sit inside the initial viewport (or its root margin),
   * the observer fires on hydration — importing the deferred chunk while
   * the hero LCP is still downloading. With this set, activation comes
   * from the shopper's first interaction or the post-LCP signal instead;
   * the LCP wait carries its own backstop, so a missing LCP still settles.
   * Defaults to false: below-fold consumers keep today's behavior.
   */
  deferUntilLcp?: boolean;
}

export function useViewportActivation<T extends HTMLElement = HTMLElement>({
  enabled = true,
  rootMargin = '600px 0px',
  threshold = 0,
  timeoutMs = 8000,
  deferUntilLcp = false,
}: UseViewportActivationOptions = {}) {
  const ref = useRef<T | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [lcpSettled, setLcpSettled] = useState(!deferUntilLcp);
  const [prevEnabled, setPrevEnabled] = useState(enabled);

  // Reset during render when the `enabled` prop flips off, instead of routing
  // the adjustment through an effect (avoids a stale-frame commit).
  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled);
    if (!enabled && isActive) {
      setIsActive(false);
    }
  }

  // Post-LCP signal for deferred gates. Only armed when opted in; the
  // wait resolves on LCP settle, interaction, or its own backstop.
  useEffect(() => {
    if (!enabled || !deferUntilLcp || lcpSettled) {
      return;
    }
    let live = true;
    void waitForLcpWindowEnd().then(() => {
      if (live) {
        setLcpSettled(true);
      }
    });
    return () => {
      live = false;
    };
  }, [enabled, deferUntilLcp, lcpSettled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // One-shot activation: the subscription tears itself down the moment it
    // fires, so the effect never re-runs in response to its own state update.
    let finished = false;
    let observer: IntersectionObserver | undefined;
    let timeoutId: number | undefined;

    const activate = () => {
      if (finished) {
        return;
      }
      finished = true;
      observer?.disconnect();
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener('pointerdown', activate);
      window.removeEventListener('keydown', activate);
      setIsActive(true);
    };

    // While the LCP window is pending, only the shopper's own interaction
    // activates — intersection and the backstop wait for the post-LCP
    // signal so deferred chunks stay out of the critical window.
    if (deferUntilLcp && !lcpSettled) {
      window.addEventListener('pointerdown', activate, { passive: true });
      window.addEventListener('keydown', activate);
      return () => {
        window.removeEventListener('pointerdown', activate);
        window.removeEventListener('keydown', activate);
      };
    }

    if (typeof window.IntersectionObserver !== 'function') {
      // Activate asynchronously so the effect never sets state synchronously.
      timeoutId = window.setTimeout(activate, 0);
      return () => {
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
        }
      };
    }

    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          activate();
        }
      },
      { rootMargin, threshold }
    );

    const element = ref.current;
    if (element) {
      observer.observe(element);
    }

    timeoutId =
      timeoutMs > 0 ? window.setTimeout(activate, timeoutMs) : undefined;

    return () => {
      observer?.disconnect();

      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener('pointerdown', activate);
      window.removeEventListener('keydown', activate);
    };
  }, [enabled, rootMargin, threshold, timeoutMs, deferUntilLcp, lcpSettled]);

  return { ref, isActive };
}
