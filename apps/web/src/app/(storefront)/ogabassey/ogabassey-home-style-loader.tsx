'use client';

import { useEffect } from 'react';
import { loadStylesheetAfterFirstInput } from '@/app/(storefront)/load-stylesheet-after-first-input';

function loadOgabasseyHomeStyles() {
  return Promise.all([
    import('@/app/(storefront)/storefront-core.css'),
    import('@/app/(storefront)/storefront-home.css'),
  ]);
}

export function OgabasseyHomeStyleLoader() {
  useEffect(
    () =>
      loadStylesheetAfterFirstInput(
        loadOgabasseyHomeStyles,
        'Failed to load OgaBassey homepage stylesheet'
      ),
    []
  );

  return null;
}
