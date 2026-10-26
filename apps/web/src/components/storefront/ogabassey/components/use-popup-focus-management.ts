'use client';

import { useEffect, useRef } from 'react';

function canReceiveFocus(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected) return false;
  for (
    let ancestor: HTMLElement | null = element;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    const style = window.getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

export function usePopupFocusManagement(
  showNewsletter: boolean,
  showAdPopup: boolean,
) {
  const restoreChatFocusAfterDismissal = useRef(false);
  const restoreFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInputModality = useRef<'keyboard' | 'pointer' | 'unknown'>('unknown');

  useEffect(() => {
    const markKeyboardInput = () => {
      lastInputModality.current = 'keyboard';
    };
    const markPointerInput = () => {
      lastInputModality.current = 'pointer';
    };
    document.addEventListener('keydown', markKeyboardInput, true);
    document.addEventListener('pointerdown', markPointerInput, true);
    return () => {
      document.removeEventListener('keydown', markKeyboardInput, true);
      document.removeEventListener('pointerdown', markPointerInput, true);
    };
  }, []);

  useEffect(() => {
    if (showNewsletter || showAdPopup || !restoreChatFocusAfterDismissal.current) {
      return;
    }
    let observer: MutationObserver | null = null;
    const stopPendingRestore = () => {
      observer?.disconnect();
      if (restoreFocusTimerRef.current) {
        clearTimeout(restoreFocusTimerRef.current);
        restoreFocusTimerRef.current = null;
      }
      document.removeEventListener('pointerdown', cancelPendingRestore, true);
      document.removeEventListener('keydown', cancelPendingRestore, true);
      document.removeEventListener('focusin', cancelPendingRestore, true);
    };
    const cancelPendingRestore = () => {
      restoreChatFocusAfterDismissal.current = false;
      stopPendingRestore();
    };
    const tryRestoreFocus = () => {
      const activeElement = document.activeElement;
      if (
        activeElement &&
        activeElement !== document.body &&
        activeElement.isConnected
      ) {
        restoreChatFocusAfterDismissal.current = false;
        stopPendingRestore();
        return true;
      }
      const launcher = document.querySelector<HTMLElement>(
        '.ogabassey-chat-anchor .ogabassey-chat-button',
      );
      if (!canReceiveFocus(launcher)) return false;
      restoreChatFocusAfterDismissal.current = false;
      launcher.focus();
      stopPendingRestore();
      return true;
    };
    if (!tryRestoreFocus()) {
      const containsPromotion = (node: Node) =>
        node instanceof Element &&
        (node.matches('.ogabassey-offer-popup, .ogabassey-newsletter-popup') ||
          node.querySelector(
            '.ogabassey-offer-popup, .ogabassey-newsletter-popup',
          ) !== null);
      observer = new MutationObserver((records) => {
        const visibilityChanged = records.some((record) =>
          record.type === 'attributes' ||
          [...record.addedNodes, ...record.removedNodes].some(containsPromotion),
        );
        if (visibilityChanged && tryRestoreFocus()) observer?.disconnect();
      });
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          'class',
          'style',
          'data-chat-launcher-offer-collision',
          'data-chat-promotion-focus-handoff',
        ],
      });
      document.addEventListener('pointerdown', cancelPendingRestore, true);
      document.addEventListener('keydown', cancelPendingRestore, true);
      document.addEventListener('focusin', cancelPendingRestore, true);
      restoreFocusTimerRef.current = setTimeout(() => {
        restoreChatFocusAfterDismissal.current = false;
        stopPendingRestore();
      }, 10_000);
    }
    return stopPendingRestore;
  }, [showAdPopup, showNewsletter]);

  const rememberPromotionFocus = (promotionSelector: string) => {
    const activeElement = document.activeElement;
    const keyboardFocused =
      lastInputModality.current === 'keyboard' ||
      (lastInputModality.current === 'unknown' &&
        activeElement instanceof HTMLElement &&
        activeElement.matches(':focus-visible'));
    restoreChatFocusAfterDismissal.current =
      keyboardFocused &&
      activeElement instanceof HTMLElement &&
      activeElement.closest(promotionSelector) !== null;
  };

  return { rememberPromotionFocus };
}
