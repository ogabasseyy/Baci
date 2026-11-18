import { useEffect } from 'react';
import { Keyboard } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';

/**
 * Defers keyboard preloading until app startup completes and the JS thread is idle,
 * cancelling immediately if the user opens the keyboard first or on unmount.
 */
export function useDeferredKeyboardPreload(startupReady: boolean): void {
  useEffect(() => {
    if (!startupReady || KeyboardController.isVisible?.()) return;

    let active = true;
    let idleCallbackId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cancelPreload = () => {
      active = false;
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
      if (!active || KeyboardController.isVisible?.()) return;
      KeyboardController.preload();
    };

    const willShowSub = Keyboard.addListener('keyboardWillShow', cancelPreload);
    const didShowSub = Keyboard.addListener('keyboardDidShow', cancelPreload);

    if (typeof requestIdleCallback === 'function') {
      idleCallbackId = requestIdleCallback(preload, { timeout: 1200 });
    } else {
      timeoutId = setTimeout(preload, 250);
    }

    return () => {
      cancelPreload();
      willShowSub.remove();
      didShowSub.remove();
    };
  }, [startupReady]);
}
