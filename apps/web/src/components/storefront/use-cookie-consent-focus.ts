'use client';

import type { FocusEvent } from 'react';
import { useEffect, useLayoutEffect, useRef } from 'react';

const useBrowserLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useCookieConsentFocus(isVisible: boolean, viewKey?: boolean) {
  const bannerRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const bannerHasFocusRef = useRef(false);
  const dismissThroughBannerRef = useRef(false);
  const viewChangeFocusRef = useRef(false);
  const previousViewKeyRef = useRef(viewKey);

  function switchView(action: () => void) {
    return () => {
      const focusIsInBanner = Boolean(
        bannerRef.current?.contains(document.activeElement)
      );
      viewChangeFocusRef.current = focusIsInBanner;
      bannerHasFocusRef.current = focusIsInBanner;
      action();
    };
  }

  function dismissWithFocus(action: () => void) {
    return () => {
      dismissThroughBannerRef.current = true;
      bannerHasFocusRef.current = Boolean(
        bannerRef.current?.contains(document.activeElement)
      );
      action();
    };
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextFocus = event.relatedTarget;
    if (
      !dismissThroughBannerRef.current &&
      !viewChangeFocusRef.current &&
      ((nextFocus instanceof Node &&
        !event.currentTarget.contains(nextFocus)) ||
        nextFocus === null)
    ) {
      bannerHasFocusRef.current = false;
    }
  }

  useBrowserLayoutEffect(() => {
    if (isVisible) {
      const restoreViewFocus =
        viewChangeFocusRef.current && previousViewKeyRef.current !== viewKey;
      previousViewKeyRef.current = viewKey;
      viewChangeFocusRef.current = false;
      dismissThroughBannerRef.current = false;
      if (restoreViewFocus) {
        const activeElement = document.activeElement;
        if (!activeElement || activeElement === document.body) {
          bannerRef.current
            ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
            ?.focus();
        } else {
          bannerHasFocusRef.current = Boolean(
            bannerRef.current?.contains(activeElement)
          );
        }
      }
      const activeElement = document.activeElement;
      const chatAnchor =
        activeElement instanceof HTMLElement
          ? activeElement.closest('.ogabassey-chat-anchor')
          : null;
      const chatIsOpen = Boolean(
        chatAnchor?.querySelector('.ogabassey-chat-window')
      );
      if (activeElement instanceof HTMLElement && chatAnchor && !chatIsOpen) {
        restoreFocusRef.current = activeElement;
        bannerRef.current
          ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
          ?.focus();
        bannerHasFocusRef.current = true;
      }
      return;
    }

    const previousFocus = restoreFocusRef.current;
    restoreFocusRef.current = null;
    viewChangeFocusRef.current = false;
    let focusTarget = previousFocus?.isConnected
      ? previousFocus
      : document.querySelector<HTMLElement>(
          '.ogabassey-chat-anchor .ogabassey-chat-button'
        );
    const chatAnchor = focusTarget?.closest<HTMLElement>(
      '.ogabassey-chat-anchor'
    );
    if (chatAnchor && getComputedStyle(chatAnchor).display === 'none') {
      focusTarget = document.querySelector<HTMLElement>(
        '.ogabassey-newsletter-popup button:not(:disabled), .ogabassey-offer-popup button:not(:disabled)'
      );
    }
    if (bannerHasFocusRef.current) focusTarget?.focus();
    bannerHasFocusRef.current = false;
    dismissThroughBannerRef.current = false;
  }, [isVisible, viewKey]);

  useEffect(() => {
    if (!isVisible) return;

    const chatWasOpen = new WeakMap<HTMLElement, boolean>();
    const currentAnchors = new Set(
      document.querySelectorAll<HTMLElement>('.ogabassey-chat-anchor')
    );
    currentAnchors.forEach((anchor) => {
      chatWasOpen.set(
        anchor,
        Boolean(anchor.querySelector('.ogabassey-chat-window'))
      );
    });
    const findAnchors = (node: Node, includeDescendants = false) => {
      const anchors = new Set<HTMLElement>();
      if (node instanceof HTMLElement) {
        if (node.matches('.ogabassey-chat-anchor')) anchors.add(node);
        if (includeDescendants) {
          for (const anchor of node.querySelectorAll<HTMLElement>(
            '.ogabassey-chat-anchor'
          )) {
            anchors.add(anchor);
          }
        }
        const ancestor = node.closest<HTMLElement>('.ogabassey-chat-anchor');
        if (ancestor) anchors.add(ancestor);
      }
      return anchors;
    };
    let observerRoot = currentAnchors.values().next().value?.parentElement;
    const observer = new MutationObserver((records) => {
      const changedAnchors = new Set<HTMLElement>();
      records.forEach(({ target, addedNodes, removedNodes }) => {
        for (const anchor of findAnchors(target)) changedAnchors.add(anchor);
        for (const node of addedNodes) {
          for (const anchor of findAnchors(node, true))
            changedAnchors.add(anchor);
        }
        for (const node of removedNodes) {
          for (const anchor of findAnchors(node, true))
            changedAnchors.add(anchor);
        }
      });
      changedAnchors.forEach((chatAnchor) => {
        if (chatAnchor.isConnected) currentAnchors.add(chatAnchor);
        else currentAnchors.delete(chatAnchor);
        const chatIsOpen = Boolean(
          chatAnchor.querySelector('.ogabassey-chat-window')
        );
        const wasOpen = chatWasOpen.get(chatAnchor) ?? false;
        if (wasOpen && !chatIsOpen) {
          const currentFocus = document.activeElement;
          if (
            !currentFocus ||
            currentFocus === document.body ||
            !(currentFocus instanceof HTMLElement) ||
            !currentFocus.isConnected ||
            currentFocus.closest('.ogabassey-chat-anchor')
          ) {
            const launcher = chatAnchor.querySelector<HTMLButtonElement>(
              '.ogabassey-chat-button'
            );
            if (launcher && !restoreFocusRef.current)
              restoreFocusRef.current = launcher;
            bannerRef.current
              ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
              ?.focus();
            bannerHasFocusRef.current = true;
          }
        }
        chatWasOpen.set(chatAnchor, chatIsOpen);
      });
      if (!observerRoot || observerRoot === document.body) {
        const mountedAnchor = currentAnchors.values().next().value;
        if (mountedAnchor?.parentElement) {
          observer.disconnect();
          observerRoot = mountedAnchor.parentElement;
          observer.observe(observerRoot, { childList: true, subtree: true });
        }
      }
    });
    observer.observe(observerRoot ?? document.body, {
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [isVisible]);

  return {
    bannerRef,
    dismissWithFocus,
    switchView,
    onFocusCapture: () => {
      bannerHasFocusRef.current = true;
    },
    onBlurCapture: handleBlur,
  };
}
