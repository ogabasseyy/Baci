'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { isCurrentChatwootBridgeTarget } from '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-target';
import { readChatwootCommerceContextMessage } from '@/components/storefront/ogabassey/components/chat/chatwoot-commerce-context-message';
import { readChatwootCommerceMessage } from '@/components/storefront/ogabassey/components/chat/chatwoot-commerce-message';
import { postChatwootCanonicalCartView } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-cart-controls';
import { handleChatwootInlineCartQuantity } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-cart-quantity';
import { buildChatwootInlineReviewResponse } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-review-response';
import { useCart } from '@/hooks/cart';
import { handleChatwootDeliveryOptionsAction } from './chatwoot-delivery-options-action';
import { authorizeChatwootInlineCartAction } from './chatwoot-inline-cart-action-authorization';
import { postChatwootInlineCartActionFailure } from './chatwoot-inline-cart-action-failure';
import { handleChatwootInlineContextHandshake } from './chatwoot-inline-cart-context-handshake';
import { rememberChatwootSessionToken } from './chatwoot-session-token-aliases';

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
    let latestRenewedGeneration = 0;
    let activeConversationId: number | null = null;
    let activeContextRequestId: string | null = null;
    let challengeToken: string | null = null;
    let challengeExpiresAt = 0;
    let authorizedSessionToken: string | null = null;
    let initialSessionToken: string | null = null;
    const sessionTokenAliases = new Set<string>();
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
      if (contextMessage) {
        await handleChatwootInlineContextHandshake({
          message: contextMessage,
          storeSlug,
          widgetOrigin,
          post: (prefix, value) => post(target, prefix, value),
          isCurrent: (conversationId, requestId) =>
            isCurrentTarget(frame, target, conversationId) &&
            activeContextRequestId === requestId,
          begin: (conversationId, requestId) => {
            activeConversationId = conversationId;
            activeContextRequestId = requestId;
            latestActionGeneration += 1;
            challengeToken = null;
            challengeExpiresAt = 0;
            authorizedSessionToken = null;
            initialSessionToken = null;
            sessionTokenAliases.clear();
            sessionExpiresAt = 0;
            lineTokens.clear();
          },
          getChallenge: () => ({
            token: challengeToken,
            expiresAt: challengeExpiresAt,
          }),
          setChallenge: (token, expiresAt) => {
            challengeToken = token;
            challengeExpiresAt = expiresAt;
          },
          setAuthorized: (token, expiresAt) => {
            authorizedSessionToken = token;
            initialSessionToken = token;
            sessionTokenAliases.clear();
            rememberChatwootSessionToken(
              sessionTokenAliases,
              token,
              initialSessionToken
            );
            sessionExpiresAt = expiresAt;
          },
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
        !sessionTokenAliases.has(messageSessionToken) ||
        sessionExpiresAt <= Date.now()
      ) {
        postChatwootInlineCartActionFailure({
          event: message.event,
          requestId,
          post: (prefix, value) => post(target, prefix, value),
        });
        return;
      }
      const actionTarget = target;
      const actionGeneration = ++latestActionGeneration;
      const requestedCartRef = latestState.current.sharedCartRef ?? null;
      const requestedMerchantSlug = latestState.current.merchantSlug;
      const { authorized, actionSessionToken, actionStillCurrent } =
        await authorizeChatwootInlineCartAction({
          isQuantityEdit: message.event === 'baci-cart-quantity',
          sessionToken: authorizedSessionToken,
          storeSlug,
          actionGeneration,
          getLatestActionGeneration: () => latestActionGeneration,
          isMessageTokenKnown: () =>
            sessionTokenAliases.has(messageSessionToken),
          tokenAliases: sessionTokenAliases,
          initialSessionToken,
          requestedCartRef,
          getCurrentCartRef: () => latestState.current.sharedCartRef ?? null,
          onSessionTokenRenewed: (token) => {
            authorizedSessionToken = token;
          },
        });
      if (
        !isCurrentTarget(frame, actionTarget, conversationId) ||
        !authorized ||
        authorized.conversationId !== conversationId ||
        !sessionTokenAliases.has(messageSessionToken) ||
        sessionExpiresAt <= Date.now() ||
        !actionStillCurrent
      ) {
        if (
          isCurrentTarget(frame, actionTarget, conversationId) &&
          actionGeneration === latestActionGeneration
        ) {
          postChatwootInlineCartActionFailure({
            event: message.event,
            requestId,
            post: (prefix, value) => post(actionTarget, prefix, value),
          });
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
          getSessionToken: () => authorizedSessionToken ?? actionSessionToken,
          isCurrentAction: () =>
            isCurrentTarget(frame, actionTarget, conversationId) &&
            actionGeneration === latestActionGeneration &&
            sessionTokenAliases.has(messageSessionToken),
          isCurrentCartContext: () => {
            const currentCart = latestState.current.sharedCartRef;
            return (
              isCurrentTarget(frame, actionTarget, conversationId) &&
              latestState.current.merchantSlug === requestedMerchantSlug &&
              requestedCartRef !== null &&
              currentCart?.cartId === requestedCartRef.cartId
            );
          },
          isCurrentContext: () =>
            isCurrentTarget(frame, actionTarget, conversationId) &&
            sessionTokenAliases.has(messageSessionToken) &&
            sessionExpiresAt > Date.now(),
          lineTokens,
          message,
          onSessionTokenRenewed: (sessionToken) => {
            // Renewal is context state, not reply state: a superseded action
            // still rotated the browser proof, so a queued retry must see it.
            // Only a renewal from a newer action replaces an already applied
            // one, so a late older response cannot roll the token back.
            if (
              actionGeneration >= latestRenewedGeneration &&
              sessionTokenAliases.has(messageSessionToken)
            ) {
              latestRenewedGeneration = actionGeneration;
              rememberChatwootSessionToken(
                sessionTokenAliases,
                sessionToken,
                initialSessionToken
              );
              authorizedSessionToken = sessionToken;
            }
          },
          post: (value) =>
            post(actionTarget, 'baci-cart-quantity-result:', value),
          refreshSharedCart: latestState.current.refreshSharedCart,
          sessionExpiresAt,
          sessionToken: actionSessionToken,
          snapshot: authorized.snapshot,
          storeSlug,
        });
        return;
      }
      if (message.event === 'baci-delivery-options-request') {
        await handleChatwootDeliveryOptionsAction({
          requestId,
          conversationId,
          sessionToken: actionSessionToken,
          state: message.data.state,
          storeSlug,
          snapshot: authorized.snapshot,
          requestedCartRef,
          getCurrentCartRef: () => latestState.current.sharedCartRef ?? null,
          isCurrent: () =>
            isCurrentTarget(frame, actionTarget, conversationId) &&
            actionGeneration === latestActionGeneration &&
            activeConversationId === conversationId &&
            sessionTokenAliases.has(messageSessionToken) &&
            sessionExpiresAt > Date.now(),
          postResult: (result) =>
            post(actionTarget, 'baci-delivery-options-result:', result),
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
