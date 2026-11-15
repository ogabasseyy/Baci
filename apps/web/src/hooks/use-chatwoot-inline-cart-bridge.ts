'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { authorizeChatwootBridgeSession } from '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-session';
import { isCurrentChatwootBridgeTarget } from '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-target';
import { readChatwootCommerceContextMessage } from '@/components/storefront/ogabassey/components/chat/chatwoot-commerce-context-message';
import { readChatwootCommerceMessage } from '@/components/storefront/ogabassey/components/chat/chatwoot-commerce-message';
import { handleChatwootInlineCartAdd } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-cart-add';
import { postChatwootCanonicalCartView } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-cart-controls';
import { handleChatwootInlineCartQuantity } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-cart-quantity';
import { handleChatwootInlineProductLookup } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-product-lookup';
import { buildChatwootInlineReviewResponse } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-review-response';
import { useCart } from '@/hooks/cart';
import {
  createChatwootActionGenerations,
  evaluateChatwootActionCartFreshness,
  isChatwootInlineActionEvent,
} from './chatwoot-inline-action-state';
import { createChatwootInlineActionContext } from './chatwoot-inline-cart-action-context';
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
    const generations = createChatwootActionGenerations();
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
            generations.beginContext();
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
          ensureCartSession: () =>
            latestState.current.ensureSharedCartSession?.() ??
            Promise.resolve(null),
        });
        return;
      }

      const message = readChatwootCommerceMessage(event, widgetOrigin, target);
      if (
        !message ||
        activeContextRequestId === null ||
        !isChatwootInlineActionEvent(message.event)
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
      const isProductRequest = message.event === 'baci-product-request';
      const action = generations.startAction(isProductRequest);
      let actionSessionToken = authorizedSessionToken;
      const requestedCartRef = latestState.current.sharedCartRef ?? null;
      const requestedMerchantSlug = latestState.current.merchantSlug;
      const authorized = await authorizeChatwootBridgeSession(
        actionSessionToken,
        storeSlug
      ).catch(() => null);
      if (
        authorized?.sessionToken &&
        sessionTokenAliases.has(messageSessionToken) &&
        action.isCurrent()
      ) {
        rememberChatwootSessionToken(
          sessionTokenAliases,
          authorized.sessionToken,
          initialSessionToken
        );
        authorizedSessionToken = authorized.sessionToken;
        actionSessionToken = authorized.sessionToken;
      }
      const { stillCurrent: actionStillCurrent } =
        evaluateChatwootActionCartFreshness({
          authorizedVersion: authorized?.snapshot.cartVersion ?? null,
          currentCartRef: latestState.current.sharedCartRef ?? null,
          event: message.event,
          generationIsCurrent: action.isCurrent(),
          merchantSlug: latestState.current.merchantSlug,
          requestedCartRef,
          requestedMerchantSlug,
        });
      if (
        !isCurrentTarget(frame, target, conversationId) ||
        !authorized ||
        authorized.conversationId !== conversationId ||
        !sessionTokenAliases.has(messageSessionToken) ||
        sessionExpiresAt <= Date.now() ||
        !actionStillCurrent
      ) {
        if (
          isCurrentTarget(frame, target, conversationId) &&
          action.isCurrent()
        ) {
          postChatwootInlineCartActionFailure({
            event: message.event,
            requestId,
            post: (prefix, value) => post(target, prefix, value),
          });
        }
        return;
      }

      if (message.event === 'baci-cart-request') {
        postChatwootCanonicalCartView({
          requestId,
          snapshot: authorized.snapshot,
          lineTokens,
          post: (payload) => target.postMessage(payload, widgetOrigin),
        });
        return;
      }
      const actionContext = createChatwootInlineActionContext({
        getCartState: () => latestState.current,
        isCurrentGeneration: action.isCurrent,
        getSessionExpiresAt: () => sessionExpiresAt,
        hasSessionAlias: () => sessionTokenAliases.has(messageSessionToken),
        isCurrentTarget: () => isCurrentTarget(frame, target, conversationId),
        onSessionTokenRenewed: (sessionToken) => {
          rememberChatwootSessionToken(
            sessionTokenAliases,
            sessionToken,
            initialSessionToken
          );
          authorizedSessionToken = sessionToken;
        },
        requestedCartRef,
        requestedMerchantSlug,
      });
      if (message.event === 'baci-product-request') {
        await handleChatwootInlineProductLookup({
          conversationId,
          isCurrentAction: actionContext.isCurrentLookup,
          post: (prefix, value) => post(target, prefix, value),
          requestId,
          sessionToken: actionSessionToken,
          slug: message.data.slug,
          storeSlug,
        });
        return;
      }
      if (message.event === 'baci-cart-quantity') {
        await handleChatwootInlineCartQuantity({
          ...actionContext,
          conversationId,
          lineTokens,
          message,
          post: (value) => post(target, 'baci-cart-quantity-result:', value),
          refreshSharedCart: latestState.current.refreshSharedCart,
          sessionExpiresAt,
          sessionToken: actionSessionToken,
          snapshot: authorized.snapshot,
          storeSlug,
        });
        return;
      }
      if (message.event === 'baci-cart-add') {
        await handleChatwootInlineCartAdd({
          ...actionContext,
          conversationId,
          message,
          post: (value) => post(target, 'baci-cart-add-result:', value),
          refreshSharedCart: latestState.current.refreshSharedCart,
          sessionExpiresAt,
          sessionToken: actionSessionToken,
          snapshot: authorized.snapshot,
          storeSlug,
        });
        return;
      }
      if (message.event === 'baci-checkout-review-request') {
        post(
          target,
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
