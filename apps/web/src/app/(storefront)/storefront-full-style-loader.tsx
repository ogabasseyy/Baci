'use client';

import { useEffect } from 'react';
import { loadStylesheetAfterFirstInput } from './load-stylesheet-after-first-input';

function loadStorefrontFullStyles() {
  return Promise.all([
    import('@/app/(storefront)/storefront-core.css'),
    import('@/app/(storefront)/storefront-full.css'),
  ]);
}

export function StorefrontFullStyleLoader() {
  useEffect(
    () =>
      loadStylesheetAfterFirstInput(
        loadStorefrontFullStyles,
        'Failed to load storefront stylesheet'
      ),
    []
  );

  return null;
}
