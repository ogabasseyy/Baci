import { type ReactNode, useEffect } from 'react';
import {
  KeyboardController,
  KeyboardProvider,
} from 'react-native-keyboard-controller';

interface AppKeyboardProviderProps {
  children: ReactNode;
  preloadAfterStartup?: boolean;
}

export default function AppKeyboardProvider({
  children,
  preloadAfterStartup = false,
}: AppKeyboardProviderProps) {
  useEffect(() => {
    if (!preloadAfterStartup) return;

    let active = true;
    const preload = () => {
      if (active) KeyboardController.preload();
    };

    if (typeof requestIdleCallback === 'function') {
      const idleCallbackId = requestIdleCallback(preload, { timeout: 1200 });
      return () => {
        active = false;
        cancelIdleCallback?.(idleCallbackId);
      };
    }

    const timeoutId = setTimeout(preload, 250);
    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [preloadAfterStartup]);

  return (
    <KeyboardProvider
      navigationBarTranslucent
      preload={false}
      preserveEdgeToEdge
      statusBarTranslucent
    >
      {children}
    </KeyboardProvider>
  );
}
