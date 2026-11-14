'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { postChatwootBridgeJson } from '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-request';
import { isCurrentChatwootBridgeTarget } from '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-target';
import { readChatwootCommerceContextMessage } from '@/components/storefront/ogabassey/components/chat/chatwoot-commerce-context-message';
import { readChatwootCommerceMessage } from '@/components/storefront/ogabassey/components/chat/chatwoot-commerce-message';
import { postChatwootCanonicalCartView } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-cart-controls';
import { buildChatwootInlineReviewResponse } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-review-response';
import { useCart } from '@/hooks/cart';
import { requestChatwootCommerceContextChallenge } from './chatwoot-commerce-context-challenge';
import { handleChatwootDeliveryOptionsAction } from './chatwoot-delivery-options-action';
import { authorizeCurrentChatwootInlineAction } from './chatwoot-inline-action-authorization';

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
    const postDeliveryUnavailable = (target: Window, requestId: string) =>
      post(target, 'baci-delivery-options-result:', {
        requestId,
        status: 'unavailable',
      });
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
        const challenge = await requestChatwootCommerceContextChallenge({
          data: contextMessage.data,
          storeSlug,
          widgetOrigin,
          isCurrent: () =>
            isCurrentTarget(frame, target, conversationId) &&
            activeContextRequestId === requestId,
          post: (prefix, value) => post(target, prefix, value),
        });
        if (!challenge) return;
        challengeToken = challenge.challengeToken;
        challengeExpiresAt = challenge.expiresAt;
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
          message.event !== 'baci-checkout-review-request' &&
          message.event !== 'baci-delivery-options-request')
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
        } else if (message.event === 'baci-delivery-options-request') {
          postDeliveryUnavailable(target, requestId);
        }
        return;
      }
      if (message.event === 'baci-cart-quantity') {
        post(target, 'baci-cart-quantity-result:', {
          requestId,
          accepted: false,
        });
        return;
      }

      const actionTarget = target;
      const actionGeneration = ++latestActionGeneration;
      const requestedCartRef = latestState.current.sharedCartRef ?? null;
      const { authorized, actionStillCurrent } =
        await authorizeCurrentChatwootInlineAction({
          sessionToken: messageSessionToken,
          storeSlug,
          actionGeneration,
          getLatestActionGeneration: () => latestActionGeneration,
          requestedCartRef,
          getCurrentCartRef: () => latestState.current.sharedCartRef ?? null,
        });
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
          } else if (message.event === 'baci-delivery-options-request') {
            postDeliveryUnavailable(actionTarget, requestId);
          } else if (message.event === 'baci-cart-request') {
            post(actionTarget, 'baci-cart-view:', {
              requestId,
              ready: false,
              items: [],
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
      if (message.event === 'baci-delivery-options-request') {
        await handleChatwootDeliveryOptionsAction({
          requestId,
          conversationId,
          sessionToken: messageSessionToken,
          state: message.data.state,
          storeSlug,
          snapshot: authorized.snapshot,
          requestedCartRef,
          getCurrentCartRef: () => latestState.current.sharedCartRef ?? null,
          isCurrent: () =>
            isCurrentTarget(frame, actionTarget, conversationId) &&
            actionGeneration === latestActionGeneration &&
            activeConversationId === conversationId &&
            authorizedSessionToken === messageSessionToken &&
            sessionExpiresAt > Date.now(),
          postResult: (result) =>
            post(actionTarget, 'baci-delivery-options-result:', result),
        });
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
