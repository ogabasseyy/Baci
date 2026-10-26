'use client';

import type { FocusEvent } from 'react';
import { useEffect, useLayoutEffect, useRef } from 'react';

const useBrowserLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

function canReceiveFocus(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected) return false;
  for (
    let ancestor: HTMLElement | null = element;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    const style = getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

export function useCookieConsentFocus(isVisible: boolean, viewKey?: boolean) {
  const bannerRef = useRef<HTMLDivElement>(null);
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
      bannerHasFocusRef.current = Boolean(
        bannerRef.current?.contains(document.activeElement)
      );
      action();
    };
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextFocus = event.relatedTarget;
    if (nextFocus instanceof Node && !event.currentTarget.contains(nextFocus)) {
      bannerHasFocusRef.current = false;
    } else if (
      !dismissThroughBannerRef.current &&
      !viewChangeFocusRef.current &&
      nextFocus === null
    ) {
      bannerHasFocusRef.current = false;
    }
  }

  useBrowserLayoutEffect(() => {
    if (isVisible) {
      if (!wasVisibleRef.current) {
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
      return;
    }

    wasVisibleRef.current = false;

    viewChangeFocusRef.current = false;
    let focusTarget = document.querySelector<HTMLElement>(
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
    const focusOrigin = bannerFocusOriginRef.current;
    if (bannerHasFocusRef.current && canReceiveFocus(focusOrigin))
      focusOrigin.focus();
    else if (bannerHasFocusRef.current) focusTarget?.focus();
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
        !bannerRef.current?.contains(previous) &&
        previous !== document.body &&
        !previous.closest('.ogabassey-offer-popup, .ogabassey-newsletter-popup')
      ) {
        bannerFocusOriginRef.current = previous;
      }
      bannerHasFocusRef.current = true;
    },
    onBlurCapture: handleBlur,
  };
}
