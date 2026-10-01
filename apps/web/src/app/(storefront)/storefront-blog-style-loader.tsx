'use client';

import { useEffect } from 'react';
import { loadStylesheetAfterFirstInput } from './load-stylesheet-after-first-input';

function loadStorefrontBlogStyles() {
  return Promise.all([
    import('@/app/(storefront)/storefront-core.css'),
    import('@/app/(storefront)/storefront-blog.css'),
  ]);
}

export function StorefrontBlogStyleLoader() {
  useEffect(
    () =>
      loadStylesheetAfterFirstInput(
        loadStorefrontBlogStyles,
        'Failed to load blog stylesheet'
      ),
    []
  );

  return null;
}
