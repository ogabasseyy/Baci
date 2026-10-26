'use client';

import { useEffect } from 'react';

export function useChatPromotionFocusHandoff() {
  useEffect(() => {
    let tabbingFromLauncher = false;
    const clearHandoff = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.ogabassey-chat-anchor .ogabassey-chat-button')
      ) {
        tabbingFromLauncher = false;
        return;
      }
      delete document.body.dataset.chatPromotionFocusHandoff;
      tabbingFromLauncher = false;
    };
    const trackKeyboardTab = (event: KeyboardEvent) => {
      tabbingFromLauncher =
        event.key === 'Tab' &&
        event.target instanceof Element &&
        event.target.matches('.ogabassey-chat-anchor .ogabassey-chat-button');
    };
    const trackFocusHandoff = (event: FocusEvent) => {
      const next = event.target;
      if (
        tabbingFromLauncher &&
        next instanceof HTMLElement &&
        !next.closest(
          '.ogabassey-chat-anchor, .ogabassey-offer-popup, .ogabassey-newsletter-popup'
        )
      ) {
        document.body.dataset.chatPromotionFocusHandoff = 'true';
      }
      tabbingFromLauncher = false;
    };

    document.addEventListener('keydown', trackKeyboardTab, true);
    document.addEventListener('focusin', trackFocusHandoff, true);
    document.addEventListener('pointerdown', clearHandoff, true);
    return () => {
      document.removeEventListener('keydown', trackKeyboardTab, true);
      document.removeEventListener('focusin', trackFocusHandoff, true);
      document.removeEventListener('pointerdown', clearHandoff, true);
      delete document.body.dataset.chatPromotionFocusHandoff;
    };
  }, []);
}
