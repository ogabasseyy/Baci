'use client';

import { useEffect } from 'react';
import { loadStylesheetAfterFirstInput } from './load-stylesheet-after-first-input';

function loadStorefrontChatStyles() {
  return import('@/app/(storefront)/storefront-chat.css');
}

export function StorefrontChatStyleLoader() {
  useEffect(
    () =>
      loadStylesheetAfterFirstInput(
        loadStorefrontChatStyles,
        'Failed to load chat stylesheet'
      ),
    []
  );

  return null;
}
