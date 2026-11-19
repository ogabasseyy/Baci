'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { authorizeChatwootBridgeSession } from '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-session';
import { isCurrentChatwootBridgeTarget } from '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-target';
import { readChatwootCommerceContextMessage } from '@/components/storefront/ogabassey/components/chat/chatwoot-commerce-context-message';
import { readChatwootCommerceMessage } from '@/components/storefront/ogabassey/components/chat/chatwoot-commerce-message';
import { postChatwootCanonicalCartView } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-cart-controls';
import { handleChatwootInlineProductLookup } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-product-lookup';
import { useCart } from '@/hooks/cart';
import { evaluateChatwootActionCartFreshness } from './chatwoot-action-cart-freshness';
import { createChatwootActionGenerations } from './chatwoot-action-generations';
import { handleChatwootDeliveryOptionsAction } from './chatwoot-delivery-options-action';
import { isChatwootInlineActionEvent } from './chatwoot-inline-action-event';
import { createChatwootInlineActionContext } from './chatwoot-inline-cart-action-context';
import { postChatwootInlineCartActionFailure } from './chatwoot-inline-cart-action-failure';
import { handleChatwootInlineContextHandshake } from './chatwoot-inline-cart-context-handshake';
import { dispatchChatwootInlineCartMutation } from './chatwoot-inline-cart-mutation-dispatch';
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
    // Bumped whenever a mutation renews the browser proof, so a slower
    // authorize response bound to the previous proof cannot overwrite it.
    let credentialEpoch = 0;
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
      const postToTarget = (prefix: string, value: unknown) =>
        post(target, prefix, value);

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
          post: postToTarget,
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
          post: postToTarget,
        });
        return;
      }
      const isProductRequest = message.event === 'baci-product-request';
      const action = generations.startAction(isProductRequest);
      let actionSessionToken = authorizedSessionToken;
      const epochAtAuthorize = credentialEpoch;
      const requestedCartRef = latestState.current.sharedCartRef ?? null;
      const requestedMerchantSlug = latestState.current.merchantSlug;
      const authorized = await authorizeChatwootBridgeSession(
        actionSessionToken,
        storeSlug
      ).catch(() => null);
      if (
        authorized?.sessionToken &&
        sessionTokenAliases.has(messageSessionToken) &&
        action.isCurrent() &&
        credentialEpoch === epochAtAuthorize
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
            post: postToTarget,
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
        canApplyRenewal: action.canApplyRenewal,
        getCartState: () => latestState.current,
        isCurrentGeneration: action.isCurrent,
        getSessionExpiresAt: () => sessionExpiresAt,
        hasSessionAlias: () => sessionTokenAliases.has(messageSessionToken),
        isCurrentTarget: () => isCurrentTarget(frame, target, conversationId),
        onSessionTokenRenewed: (sessionToken) => {
          credentialEpoch += 1;
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
          post: postToTarget,
          requestId,
          sessionToken: actionSessionToken,
          slug: message.data.slug,
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
            actionContext.isCurrentAction() && sessionExpiresAt > Date.now(),
          postResult: (result) =>
            post(target, 'baci-delivery-options-result:', result),
        });
        return;
      }
      await dispatchChatwootInlineCartMutation({
        ...actionContext,
        conversationId,
        getSessionToken: () => authorizedSessionToken ?? actionSessionToken,
        lineTokens,
        message,
        postRaw: postToTarget,
        refreshSharedCart: latestState.current.refreshSharedCart,
        requestId,
        sessionExpiresAt,
        sessionToken: actionSessionToken,
        snapshot: authorized.snapshot,
        storeSlug,
      });
    }

    window.addEventListener('message', onMessage);
    return () => {
      active = false;
      lineTokens.clear();
      window.removeEventListener('message', onMessage);
    };
  }, [storeSlug, widgetOrigin]);
}
