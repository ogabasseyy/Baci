import { waitFor } from '@testing-library/react';
import { expect, vi } from 'vitest';

export const CHATWOOT_WIDGET_ORIGIN = 'https://chatwoot.example.com';

export const CANONICAL_CART_SNAPSHOT = {
  cartVersion: 8,
  currency: 'NGN',
  estimatedTotals: false,
  items: [
    {
      lineId: 'server-line',
      name: 'Canonical Server Phone',
      productId: 'server-product',
      variantId: null,
      condition: null,
      quantity: 2,
      unitPriceMinor: 125000,
      lineTotalMinor: 250000,
    },
  ],
  itemsSubtotalMinor: 250000,
};

export const EMPTY_CART_SNAPSHOT = {
  cartVersion: 8,
  currency: 'NGN',
  estimatedTotals: false,
  items: [],
  itemsSubtotalMinor: 0,
};

export function installChatwootFrame() {
  const holder = document.createElement('div');
  holder.id = 'cw-widget-holder';
  const frame = document.createElement('iframe');
  frame.id = 'chatwoot_live_chat_widget';
  holder.append(frame);
  document.body.append(holder);
  const target = frame.contentWindow;
  if (!target) throw new Error('Expected the iframe to have a content window');
  const postMessage = vi.spyOn(target, 'postMessage').mockImplementation(() => {
    /* Ignore widget output in the fixture. */
  });
  return { holder, frame, target, postMessage };
}

export function sendChatwootWidgetMessage(
  target: Window,
  event: string,
  data: Record<string, unknown>
) {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: CHATWOOT_WIDGET_ORIGIN,
      source: target,
      data: `${event}:${JSON.stringify(data)}`,
    })
  );
}

export function authorizedCartResponse(
  conversationId: number,
  snapshotOrOnJson:
    | Record<string, unknown>
    | (() => void) = CANONICAL_CART_SNAPSHOT,
  onJson?: () => void
) {
  const snapshot =
    typeof snapshotOrOnJson === 'function'
      ? CANONICAL_CART_SNAPSHOT
      : snapshotOrOnJson;
  const afterJson =
    typeof snapshotOrOnJson === 'function' ? snapshotOrOnJson : onJson;
  return {
    ok: true,
    json: () => {
      afterJson?.();
      return Promise.resolve({
        authorized: true,
        conversationId,
        sessionExpiresAt: Math.floor(Date.now() / 1000) + 60,
        cartSnapshot: snapshot,
      });
    },
  };
}

export function authorizedEmptyCartResponse(
  conversationId: number,
  onJson?: () => void
) {
  return authorizedCartResponse(conversationId, EMPTY_CART_SNAPSHOT, onJson);
}

export function challengeResponse(
  requestId: string,
  challengeToken = `challenge-${requestId}`
) {
  return {
    ok: true,
    json: async () => ({
      requestId,
      widgetOrigin: CHATWOOT_WIDGET_ORIGIN,
      challengeToken,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    }),
  };
}

export function contextResponse(contextToken: string, sessionToken?: string) {
  const conversationId = Number(contextToken.split('-').at(-1));
  const requestId =
    conversationId === 906 ? 'context_654321' : 'context_123456';
  return {
    ok: true,
    json: async () => ({
      authorized: true,
      requestId,
      conversationId,
      sessionToken: sessionToken ?? `session-${conversationId}`,
      sessionExpiresAt: Math.floor(Date.now() / 1000) + 60,
    }),
  };
}

export async function establishChatwootWidgetContext(
  target: Window,
  postMessage: ReturnType<typeof installChatwootFrame>['postMessage'],
  conversationId = 905
) {
  const requestId =
    conversationId === 906 ? 'context_654321' : 'context_123456';
  postMessage.mockClear();
  sendChatwootWidgetMessage(target, 'baci-commerce-context-request', {
    requestId,
    conversationId,
    websiteToken: 'synthetic-widget-token-123456',
    visitorTokenSha256: 'b'.repeat(64),
  });
  await waitFor(() =>
    expect(
      postMessage.mock.calls.some(([payload]) =>
        String(payload).startsWith('baci-commerce-context-challenge:')
      )
    ).toBe(true)
  );
  sendChatwootWidgetMessage(target, 'baci-commerce-context-ready', {
    requestId,
    conversationId,
    contextToken: `context-${conversationId}`,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  });
  await waitFor(() =>
    expect(
      postMessage.mock.calls.some(([payload]) =>
        String(payload).startsWith('baci-commerce-context-authorized:')
      )
    ).toBe(true)
  );
}
