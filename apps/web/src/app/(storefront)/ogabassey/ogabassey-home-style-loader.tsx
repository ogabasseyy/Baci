'use client';

import { useEffect } from 'react';
import { loadStylesheetAfterFirstInput } from '@/app/(storefront)/load-stylesheet-after-first-input';
import { loadOgabasseyHomeStyles } from './load-ogabassey-home-styles';

const HOME_STYLESHEET_ERROR = 'Failed to load OgaBassey homepage stylesheet';
const DESKTOP_RETRY_EVENTS = [
  'pointerdown',
  'touchstart',
  'keydown',
  'pageshow',
] as const;

function armDesktopHomeStyleRetry(): () => void {
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

    for (const eventName of DESKTOP_RETRY_EVENTS) {
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
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(min-width: 768px)').matches
    ) {
      let cancelled = false;
      let stopRetry: () => void = () => undefined;
      void loadOgabasseyHomeStyles().catch((error: unknown) => {
        console.error(new Error(HOME_STYLESHEET_ERROR, { cause: error }));
        if (!cancelled) {
          stopRetry = armDesktopHomeStyleRetry();
        }
      });
      return () => {
        cancelled = true;
        stopRetry();
      };
    }

    return loadStylesheetAfterFirstInput(
      loadOgabasseyHomeStyles,
      HOME_STYLESHEET_ERROR
    );
  }, []);

  return null;
}
