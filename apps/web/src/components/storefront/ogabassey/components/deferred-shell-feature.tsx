'use client';

import type React from 'react';
import { startTransition, useEffect, useState } from 'react';

interface DeferredShellFeatureProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  timeoutMs?: number;
  enabled?: boolean;
  activateOnIdle?: boolean;
  activateOnInteraction?: boolean;
  deferInteractionActivationUntilNextPaint?: boolean;
  /**
   * When true, touch pointer gestures (`pointerType === 'touch'`, `touchstart`,
   * and the synthesized `focusin` that mobile browsers dispatch on a tapped
   * control) do not activate the feature, while fine-pointer (`mouse`/`pen`)
   * and keyboard interactions still do.
   */
  ignoreTouchInteraction?: boolean;
  /**
   * Scopes interaction activation to a specific element. When set, pointer,
   * keyboard, and `focusin` (tab-entry) activity inside this element activates
   * the feature. When omitted — or if the ref is still null when listeners
   * attach — listeners fail open to `window`, the historical default for
   * existing callers.
   */
  interactionTargetRef?: React.RefObject<HTMLElement | null>;
}

export function useDeferredActivation({
  timeoutMs = 2000,
  enabled = true,
  activateOnIdle = true,
  activateOnInteraction = true,
  deferInteractionActivationUntilNextPaint = false,
  ignoreTouchInteraction = false,
  interactionTargetRef,
}: Omit<DeferredShellFeatureProps, 'children'>) {
  const [isActivated, setIsActivated] = useState(false);

  // Reset activation inline during render when the feature gets disabled, so
  // a disabled feature never paints a stale activated frame.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled);
    if (!enabled) {
      setIsActivated(false);
    }
  }

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (isActivated) {
      return;
    }

    let cancelled = false;
    let idleCallbackId: number | undefined;
    let interactionFrameId: number | undefined;
    let interactionTimeoutId: number | undefined;
    let interactionActivationScheduled = false;
    let loadListenerAttached = false;
    let lastPointerWasTouch = false;
    let touchResetTimeoutId: number | undefined;
    let interactionListenerTarget: HTMLElement | Window | undefined;

    const markTouchInteraction = () => {
      lastPointerWasTouch = true;
      if (touchResetTimeoutId !== undefined) {
        window.clearTimeout(touchResetTimeoutId);
      }
      touchResetTimeoutId = window.setTimeout(() => {
        touchResetTimeoutId = undefined;
        lastPointerWasTouch = false;
      }, 0);
    };

    const activate = () => {
      if (!cancelled) {
        setIsActivated(true);
      }
    };
    const activateAsTransition = () => {
      if (cancelled) {
        return;
      }

      startTransition(() => {
        if (!cancelled) {
          setIsActivated(true);
        }
      });
    };
    const schedulePostPaintInteractionActivation = () => {
      if (cancelled || interactionActivationScheduled) {
        return;
      }

      interactionActivationScheduled = true;

      const activateAfterPaint = () => {
        if (cancelled) {
          return;
        }

        interactionFrameId = undefined;
        interactionTimeoutId = window.setTimeout(() => {
          interactionTimeoutId = undefined;
          activateAsTransition();
        }, 0);
      };

      if (typeof window.requestAnimationFrame === 'function') {
        interactionFrameId = window.requestAnimationFrame(activateAfterPaint);
        return;
      }

      interactionTimeoutId = window.setTimeout(() => {
        interactionTimeoutId = undefined;
        activateAsTransition();
      }, 0);
    };
    const removeInteractionListeners = () => {
      if (interactionListenerTarget === undefined) {
        return;
      }

      interactionListenerTarget.removeEventListener(
        'touchstart',
        handleTouchStart
      );
      interactionListenerTarget.removeEventListener(
        'pointerdown',
        handlePointerDown
      );
      interactionListenerTarget.removeEventListener('keydown', handleKeyDown);
      interactionListenerTarget.removeEventListener('focusin', handleFocusIn);
    };
    const handleInteraction = () => {
      removeInteractionListeners();
      if (deferInteractionActivationUntilNextPaint) {
        schedulePostPaintInteractionActivation();
        return;
      }

      activate();
    };
    const handleTouchStart = () => {
      markTouchInteraction();
    };
    const handlePointerDown = (event: Event) => {
      const pointerType =
        'pointerType' in event
          ? (event as PointerEvent).pointerType
          : undefined;
      if (pointerType === 'touch') {
        markTouchInteraction();
        if (ignoreTouchInteraction) {
          return;
        }
      } else if (pointerType === 'mouse' || pointerType === 'pen') {
        lastPointerWasTouch = false;
      }

      if (ignoreTouchInteraction && lastPointerWasTouch) {
        return;
      }

      handleInteraction();
    };
    const handleKeyDown = () => {
      lastPointerWasTouch = false;
      handleInteraction();
    };
    const handleFocusIn = () => {
      if (ignoreTouchInteraction && lastPointerWasTouch) {
        lastPointerWasTouch = false;
        return;
      }

      handleInteraction();
    };

    const scheduleIdleActivation = () => {
      if (cancelled || !activateOnIdle || idleCallbackId !== undefined) {
        return;
      }

      if (typeof window.requestIdleCallback === 'function') {
        idleCallbackId = window.requestIdleCallback(activate, {
          timeout: timeoutMs || 1000,
        });
        return;
      }

      idleCallbackId = window.setTimeout(activate, 0);
    };

    const handleWindowLoad = () => {
      window.removeEventListener('load', handleWindowLoad);
      loadListenerAttached = false;
      scheduleIdleActivation();
    };

    const timeoutId =
      timeoutMs > 0 ? window.setTimeout(activate, timeoutMs) : undefined;

    if (activateOnIdle) {
      if (document.readyState === 'complete') {
        scheduleIdleActivation();
      } else {
        loadListenerAttached = true;
        window.addEventListener('load', handleWindowLoad, { once: true });
      }
    }

    if (activateOnInteraction) {
      interactionListenerTarget = interactionTargetRef?.current ?? window;
      if (ignoreTouchInteraction) {
        interactionListenerTarget.addEventListener(
          'touchstart',
          handleTouchStart,
          { passive: true }
        );
      }
      interactionListenerTarget.addEventListener(
        'pointerdown',
        handlePointerDown,
        {
          passive: true,
        }
      );
      interactionListenerTarget.addEventListener('keydown', handleKeyDown);

      if (interactionListenerTarget !== window) {
        interactionListenerTarget.addEventListener('focusin', handleFocusIn);
      }
    }

    return () => {
      cancelled = true;

      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }

      if (idleCallbackId !== undefined) {
        if (typeof window.cancelIdleCallback === 'function') {
          window.cancelIdleCallback(idleCallbackId);
        } else {
          window.clearTimeout(idleCallbackId);
        }
      }

      if (interactionFrameId !== undefined) {
        window.cancelAnimationFrame(interactionFrameId);
      }

      if (interactionTimeoutId !== undefined) {
        window.clearTimeout(interactionTimeoutId);
      }

      if (touchResetTimeoutId !== undefined) {
        window.clearTimeout(touchResetTimeoutId);
      }

      if (loadListenerAttached) {
        window.removeEventListener('load', handleWindowLoad);
      }

      removeInteractionListeners();
    };
  }, [
    activateOnIdle,
    activateOnInteraction,
    deferInteractionActivationUntilNextPaint,
    enabled,
    ignoreTouchInteraction,
    interactionTargetRef,
    isActivated,
    timeoutMs,
  ]);

  return isActivated;
}

export function DeferredShellFeature({
  children,
  fallback = null,
  ...options
}: DeferredShellFeatureProps) {
  const isActivated = useDeferredActivation(options);

  if (!isActivated) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
