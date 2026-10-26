'use client';

import type { FocusEvent } from 'react';
import { useEffect, useLayoutEffect, useRef } from 'react';

const useBrowserLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useCookieConsentFocus(isVisible: boolean, viewKey?: boolean) {
  const bannerRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const bannerHasFocusRef = useRef(false);
  const bannerFocusOriginRef = useRef<HTMLElement | null>(null);
  const dismissThroughBannerRef = useRef(false);
  const viewChangeFocusRef = useRef(false);
  const previousViewKeyRef = useRef(viewKey);
  const wasVisibleRef = useRef(isVisible);

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
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        bannerRef.current?.contains(activeElement) &&
        !restoreFocusRef.current &&
        !bannerFocusOriginRef.current
      ) {
        const origin = activeElement.closest('.storefront-cookie-consent');
        const previous = origin?.previousElementSibling;
        if (previous instanceof HTMLElement)
          bannerFocusOriginRef.current = previous;
      }
      bannerHasFocusRef.current = Boolean(
        bannerRef.current?.contains(document.activeElement)
      );
      action();
    };
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextFocus = event.relatedTarget;
    const previousFocus = event.target;
    if (
      previousFocus instanceof HTMLElement &&
      !restoreFocusRef.current &&
      !previousFocus.closest('.ogabassey-chat-anchor') &&
      !previousFocus.closest(
        '.ogabassey-offer-popup, .ogabassey-newsletter-popup'
      )
    ) {
      bannerFocusOriginRef.current = previousFocus;
    }
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
      if (!wasVisibleRef.current && !restoreFocusRef.current) {
        const activeElement = document.activeElement;
        if (
          activeElement instanceof HTMLElement &&
          activeElement !== document.body &&
          !activeElement.closest('.ogabassey-chat-anchor') &&
          !activeElement.closest(
            '.ogabassey-offer-popup, .ogabassey-newsletter-popup'
          )
        ) {
          bannerFocusOriginRef.current = activeElement;
        }
      }
      wasVisibleRef.current = true;
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

    wasVisibleRef.current = false;

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
    if (bannerHasFocusRef.current && bannerFocusOriginRef.current?.isConnected)
      bannerFocusOriginRef.current.focus();
    else if (
      bannerHasFocusRef.current &&
      (previousFocus || (chatAnchor && !bannerFocusOriginRef.current))
    )
      focusTarget?.focus();
    bannerFocusOriginRef.current = null;
    bannerHasFocusRef.current = false;
    dismissThroughBannerRef.current = false;
  }, [isVisible, viewKey]);

  return {
    bannerRef,
    dismissWithFocus,
    switchView,
    onFocusCapture: (event: FocusEvent<HTMLDivElement>) => {
      const previous = event.relatedTarget;
      if (
        previous instanceof HTMLElement &&
        !previous.closest('.ogabassey-chat-anchor') &&
        !previous.closest('.ogabassey-offer-popup, .ogabassey-newsletter-popup')
      ) {
        bannerFocusOriginRef.current = previous;
      }
      bannerHasFocusRef.current = true;
    },
    onBlurCapture: handleBlur,
  };
}
