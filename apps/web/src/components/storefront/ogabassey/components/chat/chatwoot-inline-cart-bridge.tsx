'use client';

import { useChatwootInlineCartBridge } from '@/hooks/use-chatwoot-inline-cart-bridge';

type Props = { storeSlug: string; widgetOrigin: string };

/** Optional adapter for an already-mounted, trusted Chatwoot widget. */
export function ChatwootInlineCartBridge({ storeSlug, widgetOrigin }: Props) {
  useChatwootInlineCartBridge(storeSlug, widgetOrigin);
  return null;
}
