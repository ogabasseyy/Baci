'use client';

import { snapchatEvents } from '@/components/analytics/snapchat-pixel';
import { tiktokEvents } from '@/components/analytics/tiktok-pixel';
import { isMarketingAllowed } from '@/lib/marketing-consent';
import { socialPixelContext } from './social-pixel-context';

type Item = { id: string; name: string; price: number; quantity: number };
type FunnelEvent = 'view_item' | 'add_to_cart' | 'begin_checkout';
type Pending = {
  url: string;
  owner: Readonly<{ id: string; ready: boolean }>;
  send: () => void;
};
const pending: Record<'tiktok' | 'snapchat', Pending[]> = {
  tiktok: [],
  snapchat: [],
};
const listening = new Set<string>();
function whenReady(destination: 'tiktok' | 'snapchat', send: () => void) {
  if (!isMarketingAllowed() || typeof window === 'undefined') return;
  const owner = socialPixelContext.get(destination);
  if (!owner) return;
  const ready = () =>
    socialPixelContext.get(destination)?.ready === true &&
    (destination === 'tiktok'
      ? Boolean(window.ttq?.instance)
      : Boolean(window.snaptr));
  if (ready()) {
    send();
    return;
  }
  if (!listening.has(destination)) {
    listening.add(destination);
    window.addEventListener(`baci-${destination}-ready`, () => {
      if (!ready()) return;
      const queued = pending[destination].splice(0);
      for (const entry of queued)
        if (
          isMarketingAllowed() &&
          entry.url === window.location.href &&
          entry.owner === socialPixelContext.get(destination) &&
          ready()
        )
          entry.send();
    });
  }
  if (pending[destination].length < 100)
    pending[destination].push({ url: window.location.href, owner, send });
}
/** The actual storefront call and worker observation share this event identity. */
export function trackSocialFunnel(
  event: FunnelEvent,
  items: Item[],
  currency: string,
  eventId: string
): void {
  if (items.length === 0) return;
  const value = items.reduce(
    (total, item) => total + item.price * item.quantity,
    0
  );
  const first = items[0];
  if (!first) return;
  whenReady('tiktok', () => {
    if (event === 'begin_checkout')
      tiktokEvents.initiateCheckout(
        value,
        currency,
        items.map((i) => i.id),
        eventId
      );
    else if (event === 'add_to_cart')
      tiktokEvents.addToCart(
        first.id,
        first.name,
        first.price,
        first.quantity,
        currency,
        eventId
      );
    else
      tiktokEvents.viewContent(
        first.id,
        first.name,
        value,
        currency,
        eventId,
        items
      );
  });
  whenReady('snapchat', () => {
    if (event === 'begin_checkout')
      snapchatEvents.startCheckout(
        value,
        currency,
        items.map((i) => i.id),
        eventId
      );
    else if (event === 'add_to_cart')
      snapchatEvents.addToCart(
        first.id,
        first.price,
        currency,
        eventId,
        first.quantity
      );
    else
      snapchatEvents.viewContent(
        first.id,
        value,
        currency,
        eventId,
        items.map((item) => item.id)
      );
  });
}
