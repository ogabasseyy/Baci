'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { authorizeChatwootBridgeSession } from '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-session';
import { isCurrentChatwootBridgeTarget } from '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-target';
import { readChatwootCommerceContextMessage } from '@/components/storefront/ogabassey/components/chat/chatwoot-commerce-context-message';
import { readChatwootCommerceMessage } from '@/components/storefront/ogabassey/components/chat/chatwoot-commerce-message';
import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { evaluateChatwootActionCartFreshness } from './chatwoot-action-cart-freshness';
import { createChatwootActionGenerations } from './chatwoot-action-generations';
import { toChatwootCheckoutMerchant } from './chatwoot-checkout-merchant';
import {
  CHATWOOT_CHECKOUT_PLACE_PREFIX,
  type ChatwootCheckoutPlaceResult,
  isChatwootCheckoutEvent,
} from './chatwoot-checkout-result';
import { isChatwootInlineActionEvent } from './chatwoot-inline-action-event';
import { dispatchChatwootAuthorizedAction } from './chatwoot-inline-authorized-action';
import { postChatwootInlineCartActionFailure } from './chatwoot-inline-cart-action-failure';
import { handleChatwootInlineContextHandshake } from './chatwoot-inline-cart-context-handshake';
import { rememberChatwootSessionToken } from './chatwoot-session-token-aliases';

type ActiveCartState = ReturnType<typeof useCart>;

/** Optional adapter; feature-gated storefront integration remains separate. */
export function useChatwootInlineCartBridge(
  storeSlug: string,
  widgetOrigin: string,
  checkoutEnabled = false,
  openSecureApplication?: (path: string) => void
) {
  const cartState = useCart();
  const merchant = useMerchantSafe()?.merchant ?? null;
  const latestMerchant = useRef(merchant);
  useLayoutEffect(() => {
    latestMerchant.current = merchant;
  }, [merchant]);
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
      if (!checkoutEnabled && isChatwootCheckoutEvent(message.event)) {
        postChatwootInlineCartActionFailure({
          event: message.event,
          requestId,
          post: postToTarget,
          checkoutCode: 'disabled',
        });
        return;
      }
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
      // Read-only lookups and payment polls must not supersede a cart action.
      const action = generations.startAction(
        message.event === 'baci-product-request' ||
          message.event === 'baci-checkout-payment-status-request'
      );
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

      await dispatchChatwootAuthorizedAction({
        message,
        authorized,
        actionSessionToken,
        conversationId,
        requestId,
        storeSlug,
        action,
        requestedCartRef,
        requestedMerchantSlug,
        lineTokens,
        post: (prefix, value) => {
          postToTarget(prefix, value);
          if (
            openSecureApplication &&
            message.event === 'baci-checkout-place-request' &&
            message.data.paymentMethod === 'oxygen' &&
            prefix === CHATWOOT_CHECKOUT_PLACE_PREFIX &&
            action.isCurrent() &&
            isCurrentTarget(frame, target, conversationId)
          ) {
            const result = value as ChatwootCheckoutPlaceResult;
            if (
              result.status === 'secure_handoff' &&
              result.requestId === requestId &&
              /^\/payments\/oxygen\/[0-9a-f-]{36}$/i.test(result.href)
            ) {
              openSecureApplication(result.href);
            }
          }
        },
        postRawPayload: (payload) => target.postMessage(payload, widgetOrigin),
        getCartState: () => latestState.current,
        getMerchant: () => toChatwootCheckoutMerchant(latestMerchant.current),
        getSessionExpiresAt: () => sessionExpiresAt,
        getAuthorizedSessionToken: () => authorizedSessionToken,
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
      });
    }

    window.addEventListener('message', onMessage);
    return () => {
      active = false;
      lineTokens.clear();
      window.removeEventListener('message', onMessage);
    };
  }, [storeSlug, widgetOrigin, checkoutEnabled, openSecureApplication]);
}
