'use client';

import { useEffect } from 'react';
import { loadOgabasseyHomeStyles } from './load-ogabassey-home-styles';

const HOME_STYLESHEET_ERROR = 'Failed to load OgaBassey homepage stylesheet';
const RETRY_EVENTS = [
  'pointerdown',
  'touchstart',
  'keydown',
  'pageshow',
] as const;

function armHomeStyleRetry(): () => void {
  let cancelled = false;
  let started = false;
  const cleanups: Array<() => void> = [];

  const clearArmedListeners = () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
    cleanups.length = 0;
  };

  const stop = () => {
    cancelled = true;
    clearArmedListeners();
  };

  const arm = () => {
    const onInput = () => {
      if (cancelled || started) {
        return;
      }
      started = true;
      clearArmedListeners();
      void loadOgabasseyHomeStyles().catch((error: unknown) => {
        console.error(new Error(HOME_STYLESHEET_ERROR, { cause: error }));
        started = false;
        if (!cancelled) {
          arm();
        }
      });
    };

    for (const eventName of RETRY_EVENTS) {
      window.addEventListener(eventName, onInput, {
        once: true,
        passive: true,
      });
      cleanups.push(() => window.removeEventListener(eventName, onInput));
    }
  };

  arm();
  return stop;
}

export function OgabasseyHomeStyleLoader() {
  useEffect(() => {
    // Critical shell geometry is already in the HTML. Load the remaining home
    // styles on every viewport without requiring a tap to finish rendering.
    let cancelled = false;
    let stopRetry: () => void = () => undefined;
    void loadOgabasseyHomeStyles().catch((error: unknown) => {
      console.error(new Error(HOME_STYLESHEET_ERROR, { cause: error }));
      if (!cancelled) {
        stopRetry = armHomeStyleRetry();
      }
    });
    return () => {
      cancelled = true;
      stopRetry();
    };
  }, []);

  return null;
}
