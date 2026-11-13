'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { postChatwootBridgeJson } from '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-request';
import { authorizeChatwootBridgeSession } from '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-session';
import { isCurrentChatwootBridgeTarget } from '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-target';
import { readChatwootCommerceContextMessage } from '@/components/storefront/ogabassey/components/chat/chatwoot-commerce-context-message';
import { readChatwootCommerceMessage } from '@/components/storefront/ogabassey/components/chat/chatwoot-commerce-message';
import { postChatwootCanonicalCartView } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-cart-controls';
import { handleChatwootInlineCartQuantity } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-cart-quantity';
import { buildChatwootInlineReviewResponse } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-review-response';
import { useCart } from '@/hooks/cart';

type ActiveCartState = ReturnType<typeof useCart>;

/** Optional adapter; feature-gated storefront integration remains separate. */
export function useChatwootInlineCartBridge(
  storeSlug: string,
  widgetOrigin: string
) {
  const cartState = useCart();
  const latestState = useRef<ActiveCartState>(cartState);
  useLayoutEffect(() => {
    latestState.current = cartState;
  }, [cartState, cartState.sharedCartRef]);

  useEffect(() => {
    let active = true;
    let latestActionGeneration = 0;
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
    const isCurrentTarget = (
      frame: HTMLIFrameElement,
      target: Window,
      conversationId: number
    ) =>
      isCurrentChatwootBridgeTarget({
        active,
        frame,
        target,
        storeSlug,
        conversationId,
        activeConversationId,
        activeContextRequestId,
        cartState: {
          isHydrated: latestState.current.isHydrated,
          merchantSlug: latestState.current.merchantSlug,
          sharedCartEnabled: latestState.current.sharedCartEnabled === true,
        },
      });

    async function onMessage(event: MessageEvent) {
      const frame = document.getElementById('chatwoot_live_chat_widget');
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
        latestActionGeneration += 1;
        challengeToken = null;
        challengeExpiresAt = 0;
        authorizedSessionToken = null;
        sessionExpiresAt = 0;
        lineTokens.clear();
        let challenge: Record<string, unknown> | null;
        try {
          challenge = await postChatwootBridgeJson(
            '/api/storefront/chatwoot/context/challenge',
            contextMessage.data,
            storeSlug
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
          challenge.challengeToken.length === 0 ||
          challenge.challengeToken.length > 12_000 ||
          typeof challenge.expiresAt !== 'number' ||
          !Number.isSafeInteger(challenge.expiresAt) ||
          challenge.expiresAt * 1000 <= Date.now()
        ) {
          if (contextStillCurrent) {
            post(target, 'baci-commerce-context-denied:', { requestId });
          }
          return;
        }
        challengeToken = challenge.challengeToken;
        challengeExpiresAt = challenge.expiresAt * 1000;
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
          verified = await postChatwootBridgeJson(
            '/api/storefront/chatwoot/context/verify',
            { challengeToken: matchingChallenge, contextToken },
            storeSlug
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
          verified.sessionToken.length === 0 ||
          verified.sessionToken.length > 12_000 ||
          typeof verified.sessionExpiresAt !== 'number' ||
          !Number.isSafeInteger(verified.sessionExpiresAt) ||
          verified.sessionExpiresAt * 1000 <= Date.now()
        ) {
          if (contextStillCurrent) {
            post(target, 'baci-commerce-context-denied:', { requestId });
          }
          return;
        }
        authorizedSessionToken = verified.sessionToken;
        sessionExpiresAt = verified.sessionExpiresAt * 1000;
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

      const message = readChatwootCommerceMessage(event, widgetOrigin, target);
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
      const actionGeneration = ++latestActionGeneration;
      const requestedCartRef = latestState.current.sharedCartRef ?? null;
      let authorized: Awaited<
        ReturnType<typeof authorizeChatwootBridgeSession>
      >;
      try {
        authorized = await authorizeChatwootBridgeSession(
          messageSessionToken,
          storeSlug
        );
      } catch {
        authorized = null;
      }
      const currentCartRef = latestState.current.sharedCartRef ?? null;
      const authorizedVersionIsCurrent =
        message.event === 'baci-cart-quantity'
          ? (authorized?.snapshot.cartVersion ?? -1) >=
            (currentCartRef?.version ?? Number.POSITIVE_INFINITY)
          : authorized?.snapshot.cartVersion === currentCartRef?.version;
      const actionStillCurrent =
        actionGeneration === latestActionGeneration &&
        requestedCartRef !== null &&
        currentCartRef?.cartId === requestedCartRef.cartId &&
        currentCartRef.version === requestedCartRef.version &&
        authorizedVersionIsCurrent;
      if (
        !isCurrentTarget(frame, actionTarget, conversationId) ||
        !authorized ||
        authorized.conversationId !== conversationId ||
        messageSessionToken !== authorizedSessionToken ||
        sessionExpiresAt <= Date.now() ||
        !actionStillCurrent
      ) {
        if (
          isCurrentTarget(frame, actionTarget, conversationId) &&
          actionGeneration === latestActionGeneration
        ) {
          if (message.event === 'baci-checkout-review-request') {
            post(actionTarget, 'baci-checkout-review:', {
              requestId,
              status: 'unavailable',
            });
          } else if (message.event === 'baci-cart-request') {
            post(actionTarget, 'baci-cart-view:', {
              requestId,
              ready: false,
              items: [],
            });
          } else if (message.event === 'baci-cart-quantity') {
            post(actionTarget, 'baci-cart-quantity-result:', {
              requestId,
              accepted: false,
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
      if (message.event === 'baci-cart-quantity') {
        await handleChatwootInlineCartQuantity({
          conversationId,
          isCurrentAction: () =>
            isCurrentTarget(frame, actionTarget, conversationId) &&
            actionGeneration === latestActionGeneration &&
            messageSessionToken === authorizedSessionToken,
          isCurrentContext: () =>
            isCurrentTarget(frame, actionTarget, conversationId) &&
            messageSessionToken === authorizedSessionToken &&
            sessionExpiresAt > Date.now(),
          lineTokens,
          message,
          post: (value) =>
            post(actionTarget, 'baci-cart-quantity-result:', value),
          refreshSharedCart: latestState.current.refreshSharedCart,
          sessionExpiresAt,
          sessionToken: messageSessionToken,
          snapshot: authorized.snapshot,
          storeSlug,
        });
        return;
      }
      if (message.event === 'baci-checkout-review-request') {
        post(
          actionTarget,
          'baci-checkout-review:',
          buildChatwootInlineReviewResponse(
            requestId,
            authorized.snapshot,
            authorized.sessionExpiresAt
          )
        );
        return;
      }
    }

    window.addEventListener('message', onMessage);
    return () => {
      active = false;
      lineTokens.clear();
      window.removeEventListener('message', onMessage);
    };
  }, [storeSlug, widgetOrigin]);
}
