import { buildCsrfHeaders } from '@/lib/csrf';
import { chatwootCartReviewSnapshotSchema } from '@/schemas/chatwoot-commerce-context';

export type ChatwootBridgeCartState = {
  isHydrated: boolean;
  merchantSlug: string | null;
  sharedCartEnabled: boolean;
};

export async function postChatwootBridgeJson(
  path: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: buildCsrfHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  const value: unknown = await response.json();
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function authorizeChatwootBridgeSession(sessionToken: string) {
  const value = await postChatwootBridgeJson(
    '/api/storefront/chatwoot/context/authorize',
    { sessionToken, includeCartSnapshot: true }
  );
  if (!value) return null;
  const snapshot = chatwootCartReviewSnapshotSchema.safeParse(
    value.cartSnapshot
  );
  if (
    value.authorized !== true ||
    !Number.isSafeInteger(value.conversationId) ||
    !Number.isSafeInteger(value.sessionExpiresAt) ||
    (value.sessionExpiresAt as number) * 1000 <= Date.now() ||
    !snapshot.success
  ) {
    return null;
  }
  return {
    conversationId: value.conversationId as number,
    sessionExpiresAt: value.sessionExpiresAt as number,
    snapshot: snapshot.data,
  };
}

export function isCurrentChatwootBridgeTarget(input: {
  active: boolean;
  frame: HTMLIFrameElement;
  target: Window;
  storeSlug: string;
  conversationId: number;
  activeConversationId: number | null;
  activeContextRequestId: string | null;
  cartState: ChatwootBridgeCartState;
}): boolean {
  const currentFrame = document.getElementById('chatwoot_live_chat_widget');
  const holder = document.getElementById('cw-widget-holder');
  return Boolean(
    input.active &&
      currentFrame === input.frame &&
      input.frame.isConnected &&
      holder?.contains(input.frame) &&
      input.frame.contentWindow === input.target &&
      input.activeConversationId === input.conversationId &&
      input.activeContextRequestId !== null &&
      input.cartState.isHydrated &&
      input.cartState.merchantSlug === input.storeSlug &&
      input.cartState.sharedCartEnabled === true
  );
}
