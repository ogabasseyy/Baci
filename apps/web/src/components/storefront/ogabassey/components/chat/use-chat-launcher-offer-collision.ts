import { useEffect, useRef } from 'react';
import type { Position } from './chat-launcher-geometry';

const COLLISION_ATTRIBUTE = 'data-chat-launcher-offer-collision';

export function useChatLauncherOfferCollision(
  anchorRef: { current: HTMLDivElement | null },
  position: Position | undefined,
) {
  const syncCollisionRef = useRef<() => void>(() => {});
  const previousPositionRef = useRef(position);
  const hasPosition = position !== undefined;

  useEffect(() => {
    if (!hasPosition) return;
    let observedOffer: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let syncFrame: number | null = null;
    const syncCollision = () => {
      const anchor = anchorRef.current;
      const offer = document.querySelector<HTMLElement>(
        '.ogabassey-offer-popup',
      );
      if (offer !== observedOffer) {
        resizeObserver?.disconnect();
        observedOffer?.removeEventListener('animationend', syncCollision);
        observedOffer = offer;
        if (offer) resizeObserver?.observe(offer);
        offer?.addEventListener('animationend', syncCollision);
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
    const scheduleCollisionSync = () => {
      if (
        !observedOffer &&
        !document.querySelector('.ogabassey-offer-popup')
      ) {
        return;
      }
      if (syncFrame !== null) return;
      syncFrame = requestAnimationFrame(() => {
        syncFrame = null;
        syncCollision();
      });
    };
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(scheduleCollisionSync);
    }
    syncCollisionRef.current = syncCollision;
    syncCollision();
    const containsOffer = (node: Node) =>
      node instanceof Element &&
      (node.matches('.ogabassey-offer-popup') ||
        node.querySelector('.ogabassey-offer-popup') !== null);
    const observer = new MutationObserver((records) => {
      const offerChanged = records.some((record) =>
        [...record.addedNodes, ...record.removedNodes].some(containsOffer),
      );
      if (offerChanged) scheduleCollisionSync();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleCollisionSync);
    window.visualViewport?.addEventListener('resize', scheduleCollisionSync);
    window.visualViewport?.addEventListener('scroll', scheduleCollisionSync);
    anchorRef.current?.addEventListener('transitionend', scheduleCollisionSync);
    anchorRef.current?.addEventListener('animationend', scheduleCollisionSync);
    return () => {
      observer.disconnect();
      resizeObserver?.disconnect();
      if (syncFrame !== null) cancelAnimationFrame(syncFrame);
      observedOffer?.removeEventListener('animationend', syncCollision);
      window.removeEventListener('resize', scheduleCollisionSync);
      window.visualViewport?.removeEventListener('resize', scheduleCollisionSync);
      window.visualViewport?.removeEventListener('scroll', scheduleCollisionSync);
      anchorRef.current?.removeEventListener('transitionend', scheduleCollisionSync);
      anchorRef.current?.removeEventListener('animationend', scheduleCollisionSync);
      anchorRef.current?.removeAttribute(COLLISION_ATTRIBUTE);
      if (syncCollisionRef.current === syncCollision) {
        syncCollisionRef.current = () => {};
      }
    };
  }, [anchorRef, hasPosition]);

  useEffect(() => {
    const previousPosition = previousPositionRef.current;
    previousPositionRef.current = position;
    if (previousPosition !== undefined && position !== undefined) {
      syncCollisionRef.current();
    }
  }, [position]);
}
