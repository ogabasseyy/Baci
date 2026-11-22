'use client';

import { useChatwootInlineCartBridge } from '@/hooks/use-chatwoot-inline-cart-bridge';

type Props = {
  storeSlug: string;
  widgetOrigin: string;
  checkoutEnabled?: boolean;
};

/** Optional adapter for an already-mounted, trusted Chatwoot widget. */
export function ChatwootInlineCartBridge({
  storeSlug,
  widgetOrigin,
  checkoutEnabled = false,
}: Props) {
  useChatwootInlineCartBridge(storeSlug, widgetOrigin, checkoutEnabled);
  return null;
}
