'use client';

import { useEffect, useRef } from 'react';
import { useCart } from '@/hooks/cart';
import { buildCsrfHeaders } from '@/lib/csrf';
import {
  chatwootCartReviewSnapshotSchema,
} from '@/schemas/chatwoot-commerce-context';
import {
  readChatwootCommerceContextMessage,
  readChatwootCommerceMessage,
} from './chatwoot-commerce-message';
import {
  postChatwootCanonicalCartView,
} from './chatwoot-inline-cart-controls';
import { buildChatwootInlineReview } from './chatwoot-inline-review';

type Props = { storeSlug: string; widgetOrigin: string };

type ActiveCartState = ReturnType<typeof useCart>;

/**
 * Optional adapter for an already-mounted, trusted Chatwoot widget.
 * It is intentionally not mounted by this change; callers must separately
 * complete the feature-gated storefront integration.
 */
export function ChatwootInlineCartBridge({ storeSlug, widgetOrigin }: Props) {
  const cartState = useCart();
  const latestState = useRef<ActiveCartState>(cartState);
  latestState.current = cartState;

  useEffect(() => {
    let active = true;
    let activeConversationId: number | null = null;
    let activeContextRequestId: string | null = null;
    let challengeToken: string | null = null;
    let challengeExpiresAt = 0;
    let authorizedSessionToken: string | null = null;
    let sessionExpiresAt = 0;
    const lineTokens = new Map<string, string>();
    const post = (target: Window, prefix: string, value: unknown) => {
      target.postMessage(`${prefix}${JSON.stringify(value)}`, widgetOrigin);
    };
    const postJson = async (
      path: string,
      body: Record<string, unknown>
    ): Promise<Record<string, unknown> | null> => {
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
    };
    const isCurrentTarget = (
      frame: HTMLIFrameElement,
      target: Window,
      conversationId: number
    ) => {
      const currentFrame = document.getElementById(
        'chatwoot_live_chat_widget'
      );
      const holder = document.getElementById('cw-widget-holder');
      const state = latestState.current;
      return Boolean(
        active &&
          currentFrame === frame &&
          frame.isConnected &&
          holder?.contains(frame) &&
          frame.contentWindow === target &&
          activeConversationId === conversationId &&
          activeContextRequestId !== null &&
          state.isHydrated &&
          state.merchantSlug === storeSlug &&
          state.sharedCartEnabled === true
      );
    };
    const authorize = async (sessionToken: string) => {
      const response = await fetch(
        '/api/storefront/chatwoot/context/authorize',
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: buildCsrfHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ sessionToken, includeCartSnapshot: true }),
        }
      );
      if (!response.ok) return null;
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return null;
      }
      const value = result as Record<string, unknown>;
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
    };

    async function onMessage(event: MessageEvent) {
      const frame = document.getElementById(
        'chatwoot_live_chat_widget'
      );
      const holder = document.getElementById('cw-widget-holder');
      if (!(frame instanceof HTMLIFrameElement) || !holder?.contains(frame)) {
        return;
      }
      const target = frame.contentWindow;
      if (!target) return;

      const contextMessage = readChatwootCommerceContextMessage(
        event,
        widgetOrigin,
        target
      );
      if (contextMessage?.event === 'baci-commerce-context-request') {
        const { requestId, conversationId } = contextMessage.data;
        activeConversationId = conversationId;
        activeContextRequestId = requestId;
        challengeToken = null;
        challengeExpiresAt = 0;
        authorizedSessionToken = null;
        sessionExpiresAt = 0;
        lineTokens.clear();
        let challenge: Record<string, unknown> | null;
        try {
          challenge = await postJson(
            '/api/storefront/chatwoot/context/challenge',
            contextMessage.data
          );
        } catch {
          challenge = null;
        }
        const contextStillCurrent =
          isCurrentTarget(frame, target, conversationId) &&
          activeContextRequestId === requestId;
        if (
          !contextStillCurrent ||
          !challenge ||
          challenge.requestId !== requestId ||
          challenge.widgetOrigin !== widgetOrigin ||
          typeof challenge.challengeToken !== 'string' ||
          challenge.challengeToken.length > 12_000 ||
          !Number.isSafeInteger(challenge.expiresAt) ||
          (challenge.expiresAt as number) * 1000 <= Date.now()
        ) {
          if (contextStillCurrent) {
            post(target, 'baci-commerce-context-denied:', { requestId });
          }
          return;
        }
        challengeToken = challenge.challengeToken;
        challengeExpiresAt = (challenge.expiresAt as number) * 1000;
        post(target, 'baci-commerce-context-challenge:', {
          requestId,
          challengeToken,
        });
        return;
      }

      if (contextMessage?.event === 'baci-commerce-context-ready') {
        const { requestId, conversationId, contextToken, expiresAt } =
          contextMessage.data;
        if (
          requestId !== activeContextRequestId ||
          conversationId !== activeConversationId ||
          !challengeToken ||
          challengeExpiresAt <= Date.now() ||
          expiresAt * 1000 <= Date.now()
        ) {
          post(target, 'baci-commerce-context-denied:', { requestId });
          return;
        }
        const matchingChallenge = challengeToken;
        let verified: Record<string, unknown> | null;
        try {
          verified = await postJson(
            '/api/storefront/chatwoot/context/verify',
            { challengeToken: matchingChallenge, contextToken }
          );
        } catch {
          verified = null;
        }
        const contextStillCurrent =
          isCurrentTarget(frame, target, conversationId) &&
          activeContextRequestId === requestId &&
          challengeToken === matchingChallenge;
        if (
          !contextStillCurrent ||
          !verified ||
          verified.authorized !== true ||
          verified.requestId !== requestId ||
          verified.conversationId !== conversationId ||
          typeof verified.sessionToken !== 'string' ||
          verified.sessionToken.length > 12_000 ||
          !Number.isSafeInteger(verified.sessionExpiresAt) ||
          (verified.sessionExpiresAt as number) * 1000 <= Date.now()
        ) {
          if (contextStillCurrent) {
            post(target, 'baci-commerce-context-denied:', { requestId });
          }
          return;
        }
        authorizedSessionToken = verified.sessionToken;
        sessionExpiresAt = (verified.sessionExpiresAt as number) * 1000;
        challengeToken = null;
        challengeExpiresAt = 0;
        post(target, 'baci-commerce-context-authorized:', {
          requestId,
          conversationId,
          sessionToken: authorizedSessionToken,
          sessionExpiresAt: verified.sessionExpiresAt,
        });
        return;
      }

      const message = readChatwootCommerceMessage(
        event,
        widgetOrigin,
        target
      );
      if (
        !message ||
        activeContextRequestId === null ||
        (message.event !== 'baci-cart-request' &&
          message.event !== 'baci-cart-quantity' &&
          message.event !== 'baci-checkout-review-request')
      ) {
        return;
      }

      const {
        conversationId,
        requestId,
        sessionToken: messageSessionToken,
      } = message.data;
      if (
        activeConversationId !== conversationId ||
        !authorizedSessionToken ||
        authorizedSessionToken !== messageSessionToken ||
        sessionExpiresAt <= Date.now()
      ) {
        if (message.event === 'baci-checkout-review-request') {
          post(target, 'baci-checkout-review:', {
            requestId,
            status: 'unavailable',
          });
        }
        return;
      }
      const actionTarget = target;
      let authorized: Awaited<ReturnType<typeof authorize>>;
      try {
        authorized = await authorize(messageSessionToken);
      } catch {
        authorized = null;
      }
      if (
        !isCurrentTarget(frame, actionTarget, conversationId) ||
        !authorized ||
        authorized.conversationId !== conversationId ||
        messageSessionToken !== authorizedSessionToken ||
        sessionExpiresAt <= Date.now()
      ) {
        if (isCurrentTarget(frame, actionTarget, conversationId)) {
          if (message.event === 'baci-checkout-review-request') {
            post(actionTarget, 'baci-checkout-review:', {
              requestId,
              status: 'unavailable',
            });
          }
        }
        return;
      }

      if (message.event === 'baci-cart-request') {
        postChatwootCanonicalCartView({
          requestId,
          snapshot: authorized.snapshot,
          lineTokens,
          post: (payload) => actionTarget.postMessage(payload, widgetOrigin),
        });
        return;
      }
      if (message.event === 'baci-checkout-review-request') {
        const review = buildChatwootInlineReview(authorized.snapshot);
        const remainingTtlMs = Math.min(
          30 * 60 * 1000,
          authorized.sessionExpiresAt * 1000 - Date.now()
        );
        post(actionTarget, 'baci-checkout-review:',
          review && !review.estimatedTotals && remainingTtlMs > 0
            ? {
                requestId,
                status: 'ready',
                remainingTtlMs,
                cartVersion: review.cartVersion,
                currency: review.currency,
                subtotalMinor: review.itemsSubtotalMinor,
                items: review.items.map((item) => ({
                  name: item.name,
                  quantity: item.quantity,
                  unitPriceMinor: item.unitPriceMinor,
                  lineTotalMinor: item.lineTotalMinor,
                })),
              }
            : { requestId, status: 'unavailable' }
        );
        return;
      }

      // Cart mutations need a durable server receipt. This PR deliberately
      // exposes only read/review; reject widget quantity actions until that
      // receipt path is added.
      post(actionTarget, 'baci-cart-quantity-result:', {
        requestId,
        accepted: false,
      });
    }

    window.addEventListener('message', onMessage);
    return () => {
      active = false;
      lineTokens.clear();
      window.removeEventListener('message', onMessage);
    };
  }, [storeSlug, widgetOrigin]);

  return null;
}
