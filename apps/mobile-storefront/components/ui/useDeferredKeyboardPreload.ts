import { useEffect, useRef } from 'react';
import { Keyboard } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';

/** Preload opportunistically after startup, unless the keyboard has opened. */
export function useDeferredKeyboardPreload(startupReady: boolean): void {
  const keyboardOpenedRef = useRef(false);

  useEffect(() => {
    // Skip optional warmup on runtimes that cannot schedule idle work.
    // A timer can interrupt the first interaction, and input focus opens the keyboard normally.
    if (typeof requestIdleCallback !== 'function') return;

    let active = true;
    let frameId: number | null = null;
    let idleCallbackId: number | null = null;

    const cancelPreload = () => {
      active = false;
      if (frameId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      if (idleCallbackId !== null && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(idleCallbackId);
        idleCallbackId = null;
      }
    };

    const markOpened = () => {
      keyboardOpenedRef.current = true;
      cancelPreload();
    };
    const willShowSub = Keyboard.addListener('keyboardWillShow', markOpened);
    const didShowSub = Keyboard.addListener('keyboardDidShow', markOpened);

    if (
      startupReady &&
      !keyboardOpenedRef.current &&
      !KeyboardController.isVisible?.()
    ) {
      const scheduleIdlePreload = () => {
        frameId = null;
        if (!active) return;
        idleCallbackId = requestIdleCallback(() => {
          idleCallbackId = null;
          if (active && !KeyboardController.isVisible?.()) {
            KeyboardController.preload();
          }
        });
      };

      // Let two post-splash frames commit before asking for idle time.
      if (typeof requestAnimationFrame === 'function') {
        frameId = requestAnimationFrame(() => {
          if (!active) return;
          frameId = requestAnimationFrame(scheduleIdlePreload);
        });
      } else {
        scheduleIdlePreload();
      }
    }

    return () => {
      cancelPreload();
      willShowSub.remove();
      didShowSub.remove();
    };
  }, [startupReady]);
}
