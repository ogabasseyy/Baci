import { useEffect } from 'react';
import type { Position } from './chat-launcher-geometry';

const COLLISION_ATTRIBUTE = 'data-chat-launcher-offer-collision';

export function useChatLauncherOfferCollision(
  anchorRef: { current: HTMLDivElement | null },
  position: Position | undefined,
) {
  useEffect(() => {
    if (!position) return;
    let observedOffer: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const syncCollision = () => {
      const anchor = anchorRef.current;
      const offer = document.querySelector<HTMLElement>(
        '.ogabassey-offer-popup',
      );
      if (offer !== observedOffer) {
        resizeObserver?.disconnect();
        observedOffer = offer;
        if (offer) resizeObserver?.observe(offer);
      }
      if (!anchor || !offer) {
        anchor?.removeAttribute(COLLISION_ATTRIBUTE);
        return;
      }
      const launcherRect = anchor.getBoundingClientRect();
      const offerRect = offer.getBoundingClientRect();
      const overlaps =
        launcherRect.left < offerRect.right &&
        launcherRect.right > offerRect.left &&
        launcherRect.top < offerRect.bottom &&
        launcherRect.bottom > offerRect.top;
      anchor.toggleAttribute(COLLISION_ATTRIBUTE, overlaps);
    };
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(syncCollision);
    }
    syncCollision();
    const observer = new MutationObserver(syncCollision);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', syncCollision);
    window.visualViewport?.addEventListener('resize', syncCollision);
    window.visualViewport?.addEventListener('scroll', syncCollision);
    return () => {
      observer.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', syncCollision);
      window.visualViewport?.removeEventListener('resize', syncCollision);
      window.visualViewport?.removeEventListener('scroll', syncCollision);
      anchorRef.current?.removeAttribute(COLLISION_ATTRIBUTE);
    };
  }, [anchorRef, position]);
}
