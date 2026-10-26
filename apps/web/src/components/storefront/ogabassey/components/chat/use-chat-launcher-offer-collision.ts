import { useEffect, useRef } from 'react';
import type { Position } from './chat-launcher-geometry';

const COLLISION_ATTRIBUTE = 'data-chat-launcher-offer-collision';

export function useChatLauncherOfferCollision(
  anchorRef: { current: HTMLDivElement | null },
  position: Position | undefined,
  active = true,
) {
  const syncCollisionRef = useRef<() => void>(() => {});
  const previousPositionRef = useRef(position);
  const hasPosition = position !== undefined;

  useEffect(() => {
    if (!active || !hasPosition) return;
    let observedOffer: HTMLElement | null = null;
    let observedOverflow = new Set<HTMLElement>();
    let resizeObserver: ResizeObserver | null = null;
    let syncFrame: number | null = null;
    const syncCollision = () => {
      const anchor = anchorRef.current;
      const offer = document.querySelector<HTMLElement>(
        '.ogabassey-offer-popup',
      );
      const overflowElements = new Set(
        anchor?.querySelectorAll<HTMLElement>('[data-chat-launcher-overflow]') ??
          [],
      );
      for (const previous of observedOverflow) {
        if (!overflowElements.has(previous)) resizeObserver?.unobserve(previous);
      }
      for (const current of overflowElements) {
        if (!observedOverflow.has(current)) resizeObserver?.observe(current);
      }
      observedOverflow = overflowElements;
      if (offer !== observedOffer) {
        if (observedOffer) resizeObserver?.unobserve(observedOffer);
        observedOffer?.removeEventListener('animationend', syncCollision);
        observedOffer = offer;
        if (offer) resizeObserver?.observe(offer);
        offer?.addEventListener('animationend', syncCollision);
      }
      if (!anchor || !offer) {
        anchor?.removeAttribute(COLLISION_ATTRIBUTE);
        return;
      }
      const offerRect = offer.getBoundingClientRect();
      const launcher = anchor.querySelector<HTMLElement>(
        '.ogabassey-chat-button',
      );
      const visibleRects = [
        (launcher ?? anchor).getBoundingClientRect(),
        ...[...overflowElements]
          .filter((element) => {
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
          })
          .map((element) => element.getBoundingClientRect()),
      ];
      const overlaps = visibleRects.some(
        (rect) =>
          rect.left < offerRect.right &&
          rect.right > offerRect.left &&
          rect.top < offerRect.bottom &&
          rect.bottom > offerRect.top,
      );
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
      if (anchorRef.current) resizeObserver.observe(anchorRef.current);
    }
    syncCollisionRef.current = syncCollision;
    syncCollision();
    const containsCollisionElement = (node: Node) =>
      node instanceof Element &&
      (node.matches('.ogabassey-offer-popup, [data-chat-launcher-overflow]') ||
        node.querySelector(
          '.ogabassey-offer-popup, [data-chat-launcher-overflow]',
        ) !== null);
    const observer = new MutationObserver((records) => {
      const offerChanged = records.some((record) =>
        [...record.addedNodes, ...record.removedNodes].some(
          containsCollisionElement,
        ),
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
  }, [active, anchorRef, hasPosition]);

  useEffect(() => {
    const previousPosition = previousPositionRef.current;
    previousPositionRef.current = position;
    if (previousPosition !== undefined && position !== undefined) {
      syncCollisionRef.current();
    }
  }, [position]);
}
