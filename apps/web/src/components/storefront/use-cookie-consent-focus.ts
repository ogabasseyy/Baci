'use client';

import type { FocusEvent } from 'react';
import { useEffect, useRef } from 'react';

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
      !viewChangeFocusRef.current &&
      ((nextFocus instanceof Node &&
        !event.currentTarget.contains(nextFocus)) ||
        (nextFocus === null && !dismissThroughBannerRef.current))
    ) {
      bannerHasFocusRef.current = false;
    }
  }

  useEffect(() => {
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
    if (bannerHasFocusRef.current && previousFocus?.isConnected)
      previousFocus.focus();
    bannerHasFocusRef.current = false;
    dismissThroughBannerRef.current = false;
  }, [isVisible, viewKey]);

  useEffect(() => {
    if (!isVisible) return;

    const activeElement = document.activeElement;
    const chatAnchor =
      activeElement instanceof HTMLElement
        ? activeElement.closest('.ogabassey-chat-anchor')
        : null;
    if (!chatAnchor?.querySelector('.ogabassey-chat-window')) return;

    let chatWasOpen = true;
    const observer = new MutationObserver(() => {
      const chatIsOpen = Boolean(
        chatAnchor.querySelector('.ogabassey-chat-window')
      );
      if (chatWasOpen && !chatIsOpen) {
        const currentFocus = document.activeElement;
        if (
          !currentFocus ||
          currentFocus === document.body ||
          !(currentFocus instanceof HTMLElement) ||
          !currentFocus.isConnected ||
          currentFocus.closest('.ogabassey-chat-anchor')
        ) {
          bannerRef.current
            ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
            ?.focus();
          bannerHasFocusRef.current = true;
        }
      }
      chatWasOpen = chatIsOpen;
    });
    observer.observe(chatAnchor, { childList: true, subtree: true });
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
