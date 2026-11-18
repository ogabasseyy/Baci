import { useEffect, useRef } from 'react';
import { Keyboard } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';

/**
 * Defers keyboard preloading until app startup completes, post-splash frames settle,
 * and the JS thread is idle, cancelling immediately if the user opens the keyboard
 * before or after readiness or on unmount.
 */
export function useDeferredKeyboardPreload(startupReady: boolean): void {
  const keyboardOpenedRef = useRef(false);

  useEffect(() => {
    const markOpened = () => {
      keyboardOpenedRef.current = true;
    };
    const willShowSub = Keyboard.addListener('keyboardWillShow', markOpened);
    const didShowSub = Keyboard.addListener('keyboardDidShow', markOpened);
    return () => {
      willShowSub.remove();
      didShowSub.remove();
    };
  }, []);

  useEffect(() => {
    if (
      !startupReady ||
      keyboardOpenedRef.current ||
      KeyboardController.isVisible?.()
    )
      return;

    let active = true;
    let firstFrameId: number | null = null;
    let secondFrameId: number | null = null;
    let idleCallbackId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cancelPreload = () => {
      active = false;
      if (firstFrameId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(firstFrameId);
        firstFrameId = null;
      }
      if (
        secondFrameId !== null &&
        typeof cancelAnimationFrame === 'function'
      ) {
        cancelAnimationFrame(secondFrameId);
        secondFrameId = null;
      }
      if (idleCallbackId !== null && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(idleCallbackId);
        idleCallbackId = null;
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const preload = () => {
      if (
        !active ||
        keyboardOpenedRef.current ||
        KeyboardController.isVisible?.()
      )
        return;
      KeyboardController.preload();
    };

    const scheduleIdlePreload = () => {
      if (!active || keyboardOpenedRef.current) return;
      if (typeof requestIdleCallback === 'function') {
        idleCallbackId = requestIdleCallback(preload, { timeout: 1200 });
      } else {
        timeoutId = setTimeout(preload, 250);
      }
    };

    const willShowSub = Keyboard.addListener('keyboardWillShow', cancelPreload);
    const didShowSub = Keyboard.addListener('keyboardDidShow', cancelPreload);

    // Wait two frames after splash readiness so the first interactive storefront
    // frame commits cleanly before any UIKit preload work is scheduled.
    if (typeof requestAnimationFrame === 'function') {
      firstFrameId = requestAnimationFrame(() => {
        if (!active || keyboardOpenedRef.current) return;
        secondFrameId = requestAnimationFrame(scheduleIdlePreload);
      });
    } else {
      scheduleIdlePreload();
    }

    return () => {
      cancelPreload();
      willShowSub.remove();
      didShowSub.remove();
    };
  }, [startupReady]);
}
