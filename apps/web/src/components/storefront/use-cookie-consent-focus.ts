'use client';

import type { FocusEvent } from 'react';
import { useEffect, useRef } from 'react';

export function useCookieConsentFocus(isVisible: boolean) {
  const bannerRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const bannerHasFocusRef = useRef(false);
  const dismissThroughBannerRef = useRef(false);

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
      (nextFocus instanceof Node && !event.currentTarget.contains(nextFocus)) ||
      (nextFocus === null && !dismissThroughBannerRef.current)
    ) {
      bannerHasFocusRef.current = false;
    }
  }

  useEffect(() => {
    if (isVisible) {
      dismissThroughBannerRef.current = false;
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
    if (bannerHasFocusRef.current && previousFocus?.isConnected)
      previousFocus.focus();
    bannerHasFocusRef.current = false;
    dismissThroughBannerRef.current = false;
  }, [isVisible]);

  return {
    bannerRef,
    dismissWithFocus,
    onFocusCapture: () => {
      bannerHasFocusRef.current = true;
    },
    onBlurCapture: handleBlur,
  };
}
