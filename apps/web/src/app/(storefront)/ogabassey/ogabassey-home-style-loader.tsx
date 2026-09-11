'use client';

import { useEffect } from 'react';
import { loadStylesheetAfterFirstInput } from '@/app/(storefront)/load-stylesheet-after-first-input';
import { loadOgabasseyHomeStyles } from './load-ogabassey-home-styles';

const HOME_STYLESHEET_ERROR = 'Failed to load OgaBassey homepage stylesheet';

export function OgabasseyHomeStyleLoader() {
  useEffect(() => {
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(min-width: 768px)').matches
    ) {
      void loadOgabasseyHomeStyles().catch((error: unknown) => {
        console.error(new Error(HOME_STYLESHEET_ERROR, { cause: error }));
      });
      return;
    }

    return loadStylesheetAfterFirstInput(
      loadOgabasseyHomeStyles,
      HOME_STYLESHEET_ERROR
    );
  }, []);

  return null;
}
