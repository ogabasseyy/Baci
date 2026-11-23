'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isOxygenStorefrontStagingEnabled } from '@/config/oxygen-storefront-staging';
import { useCartSafe } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/merchant';
import { useChatwootInlineCartBridge } from '@/hooks/use-chatwoot-inline-cart-bridge';
import { joinRouteBasePath } from '@/lib/routes';
import { ChatwootOrdersPanel } from './chatwoot-orders-panel';
import { ChatwootOxygenCard } from './chatwoot-oxygen-card';
import { ChatwootSignInPanel } from './chatwoot-sign-in-panel';
import { createEkaetteBankLookup } from './ekaette-bank-lookup';
import { createEkaetteCheckoutTurnLookup } from './ekaette-checkout-turn';
import { createEkaetteDeliveryLookup } from './ekaette-delivery-lookup';

type Props = {
  storeSlug: string;
  widgetOrigin: string;
  checkoutEnabled?: boolean;
  oxygenHostedOrigins?: readonly string[];
};

/** Optional adapter for an already-mounted, trusted Chatwoot widget. */
export function ChatwootInlineCartBridge({
  storeSlug,
  widgetOrigin,
  checkoutEnabled = false,
  oxygenHostedOrigins,
}: Props) {
  const merchant = useMerchantSafe();
  const cart = useCartSafe();
  const latestCart = useRef(cart);
  useLayoutEffect(() => {
    latestCart.current = cart;
  }, [cart]);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [applicationPath, setApplicationPath] = useState<string | null>(null);
  const inlineEnabled = checkoutEnabled && isOxygenStorefrontStagingEnabled();
  useChatwootInlineCartBridge(
    storeSlug,
    widgetOrigin,
    checkoutEnabled,
    inlineEnabled ? setApplicationPath : undefined
  );
  const basePath = merchant?.basePath;
  const activeSlug = merchant?.merchant?.slug;
  const merchantId = merchant?.merchant?.id;
  useEffect(() => {
    if (!inlineEnabled || activeSlug !== storeSlug || basePath === undefined)
      return;
    const delivery = createEkaetteDeliveryLookup(() => {
      const current = latestCart.current;
      const ref = current?.sharedCartRef;
      if (!merchantId || !current || current.merchantSlug !== storeSlug || !ref || !current.cart.length)
        return null;
      return {
        key: `${ref.cartId}:${ref.version}`,
        merchantId,
        subtotal: current.subtotal,
        items: current.cart.map(item => ({
          name: item.name,
          quantity: item.quantity,
          weight: 1,
          value: item.negotiatedPrice ?? item.price,
        })),
      };
    }, storeSlug);
    const bank = createEkaetteBankLookup(storeSlug);
    const turn = createEkaetteCheckoutTurnLookup(storeSlug);
    let active = true;
    const openTool = (event: MessageEvent) => {
      if (event.origin !== widgetOrigin) return;
      const frame = document.getElementById('chatwoot_live_chat_widget');
      const holder = document.getElementById('cw-widget-holder');
      if (
        !(frame instanceof HTMLIFrameElement) ||
        !holder?.contains(frame) ||
        !frame.contentWindow ||
        event.source !== frame.contentWindow ||
        frame.inert
      ) return;
      const target = frame.contentWindow;
      void delivery.receive(event.data, (result) => {
        if (active && document.getElementById('chatwoot_live_chat_widget') === frame && !frame.inert)
          target.postMessage(`baci-ekaette-delivery-result:${JSON.stringify(result)}`, widgetOrigin);
      });
      void bank.receive(event.data, (result) => {
        if (active && document.getElementById('chatwoot_live_chat_widget') === frame && !frame.inert)
          target.postMessage(`baci-ekaette-bank-result:${JSON.stringify(result)}`, widgetOrigin);
      });
      void turn.receive(event.data, (result) => {
        if (active && document.getElementById('chatwoot_live_chat_widget') === frame && !frame.inert)
          target.postMessage(`baci-ekaette-checkout-turn-result:${JSON.stringify(result)}`, widgetOrigin);
      });
      if (event.data === 'baci-ekaette-checkout-sign-in') setSignInOpen(true);
      if (event.data === 'baci-ekaette-open-orders') setOrdersOpen(true);
      if (
        typeof event.data === 'string' &&
        event.data.startsWith('baci-ekaette-copy-text:') &&
        event.data.length <= 256
      ) {
        try {
          const parsed = JSON.parse(
            event.data.slice('baci-ekaette-copy-text:'.length)
          ) as { requestId?: unknown; text?: unknown };
          const requestId =
            typeof parsed.requestId === 'string' ? parsed.requestId : '';
          const text =
            typeof parsed.text === 'string' && parsed.text.length <= 64
              ? parsed.text
              : '';
          if (requestId && text) {
            void (async () => {
              let ok = false;
              try {
                if (navigator.clipboard?.writeText) {
                  await navigator.clipboard.writeText(text);
                  ok = true;
                }
              } catch {
                ok = false;
              }
              if (!ok) {
                try {
                  const el = document.createElement('textarea');
                  el.value = text;
                  el.setAttribute('readonly', '');
                  el.style.position = 'fixed';
                  el.style.opacity = '0';
                  document.body.appendChild(el);
                  el.select();
                  ok = document.execCommand('copy');
                  document.body.removeChild(el);
                } catch {
                  ok = false;
                }
              }
              if (
                active &&
                document.getElementById('chatwoot_live_chat_widget') === frame &&
                !frame.inert
              ) {
                target.postMessage(
                  `baci-ekaette-copy-result:${JSON.stringify({ requestId, ok })}`,
                  widgetOrigin
                );
              }
            })();
          }
        } catch {
          // Ignore malformed copy payloads
        }
      }
      if (event.data === 'baci-ekaette-open-repairs') {
        window.location.assign(joinRouteBasePath(basePath, '/repairs'));
      }
    };
    window.addEventListener('message', openTool);
    return () => {
      active = false;
      delivery.close();
      bank.close();
      turn.close();
      window.removeEventListener('message', openTool);
    };
  }, [activeSlug, basePath, inlineEnabled, merchantId, storeSlug, widgetOrigin]);

  if (!inlineEnabled) return null;
  return (
    <>
      {signInOpen && (
        <ChatwootSignInPanel
          storeSlug={storeSlug}
          onClose={() => setSignInOpen(false)}
          onSuccess={() => {
            const frame = document.getElementById('chatwoot_live_chat_widget');
            if (frame instanceof HTMLIFrameElement) {
              frame.contentWindow?.postMessage('baci-ekaette-checkout-signed-in', widgetOrigin);
            }
          }}
        />
      )}
      {applicationPath && (
        <ChatwootOxygenCard
          key={applicationPath}
          orderId={applicationPath.split('/').at(-1) ?? ''}
          storeSlug={storeSlug}
          hostedOrigins={oxygenHostedOrigins}
        />
      )}
      {ordersOpen && (
        <ChatwootOrdersPanel
          storeSlug={storeSlug}
          onClose={() => setOrdersOpen(false)}
          onContinueApplication={(orderId) => {
            setOrdersOpen(false);
            setApplicationPath(`/payments/oxygen/${orderId}`);
          }}
        />
      )}
    </>
  );
}
