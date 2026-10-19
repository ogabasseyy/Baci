'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useEffect } from 'react';
import { runWhenPageActivated } from '@/lib/dom/run-when-page-activated';

/**
 * Activates deferred cart validation on idle, first interaction, or
 * timeout — never inside a speculatively prerendered hidden page, so a
 * discarded prerender cannot mutate the shopper's real cart.
 */
export function useDeferredValidationActivation({
  deferValidationUntilIdle,
  idleValidationActivated,
  validationActivationTimeoutMs,
  onActivate,
}: {
  deferValidationUntilIdle: boolean;
  idleValidationActivated: boolean;
  validationActivationTimeoutMs: number;
  onActivate: Dispatch<SetStateAction<boolean>>;
}): void {
  useEffect(() => {
    if (!deferValidationUntilIdle || idleValidationActivated) {
      return;
    }

    let cancelled = false;
    let idleCallbackId: number | undefined;
    let loadListenerAttached = false;
    let cancelActivationGate: (() => void) | undefined;
    const activateValidation = () => {
      if (cancelled) {
        return;
      }
      // A speculatively prerendered PDP (Speculation Rules `prerender`) runs
      // this provider's JS in a hidden tab. Committing validation there would
      // POST /api/cart/validate and persist the result to the shared cart
      // storage for a page the shopper may never open — mutating their real
      // cart or clearing negotiations. Defer the commit until the page is
      // actually presented; a discarded prerender never activates, so it never
      // runs. Outside prerender this invokes the callback synchronously, so
      // behaviour is unchanged.
      cancelActivationGate?.();
      cancelActivationGate = runWhenPageActivated(() => {
        if (!cancelled) {
          onActivate(true);
        }
      });
    };

    const scheduleIdleActivation = () => {
      if (cancelled || idleCallbackId !== undefined) return;

      if (typeof window.requestIdleCallback === 'function') {
        idleCallbackId = window.requestIdleCallback(activateValidation, {
          timeout: validationActivationTimeoutMs || 1000,
        });
        return;
      }

      idleCallbackId = window.setTimeout(activateValidation, 0);
    };

    const handleWindowLoad = () => {
      window.removeEventListener('load', handleWindowLoad);
      loadListenerAttached = false;
      scheduleIdleActivation();
    };

    const timeoutId =
      validationActivationTimeoutMs > 0
        ? window.setTimeout(activateValidation, validationActivationTimeoutMs)
        : undefined;

    if (document.readyState === 'complete') {
      scheduleIdleActivation();
    } else {
      loadListenerAttached = true;
      window.addEventListener('load', handleWindowLoad, { once: true });
    }

    window.addEventListener('pointerdown', activateValidation, {
      once: true,
      passive: true,
    });
    window.addEventListener('keydown', activateValidation, { once: true });
    window.addEventListener('scroll', activateValidation, {
      once: true,
      passive: true,
    });

    return () => {
      cancelled = true;
      cancelActivationGate?.();
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);

      if (idleCallbackId !== undefined) {
        if (typeof window.cancelIdleCallback === 'function') {
          window.cancelIdleCallback(idleCallbackId);
        } else {
          window.clearTimeout(idleCallbackId);
        }
      }

      if (loadListenerAttached) {
        window.removeEventListener('load', handleWindowLoad);
      }

      window.removeEventListener('pointerdown', activateValidation);
      window.removeEventListener('keydown', activateValidation);
      window.removeEventListener('scroll', activateValidation);
    };
  }, [
    deferValidationUntilIdle,
    idleValidationActivated,
    validationActivationTimeoutMs,
    onActivate,
  ]);
}
