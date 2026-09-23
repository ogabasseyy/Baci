'use client';

import { useEffect } from 'react';

function loadStorefrontChatStyles() {
  return import('@/app/(storefront)/storefront-chat.css');
}

/** Load the launcher sheet when the already-deferred chat widget mounts.
 *  First-input deferral left the 1.6s footer chrome unstyled until an
 *  unrelated tap, so the launcher sat in normal flow instead of the corner. */
export function StorefrontChatStyleLoader() {
  useEffect(() => {
    void loadStorefrontChatStyles().catch((error: unknown) => {
      console.error(
        new Error('Failed to load chat stylesheet', { cause: error })
      );
    });
  }, []);

  return null;
}
