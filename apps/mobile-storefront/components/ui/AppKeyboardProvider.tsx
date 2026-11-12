import { type ReactNode, useEffect } from 'react';
import {
  KeyboardController,
  KeyboardProvider,
} from 'react-native-keyboard-controller';

interface AppKeyboardProviderProps {
  children: ReactNode;
  startupReady?: boolean;
}

export default function AppKeyboardProvider({
  children,
  startupReady = false,
}: AppKeyboardProviderProps) {
  useEffect(() => {
    if (!startupReady) return;

    let active = true;
    const preload = () => {
      if (active) KeyboardController.preload();
    };

    if (typeof requestIdleCallback === 'function') {
      const idleCallbackId = requestIdleCallback(preload, { timeout: 1200 });
      return () => {
        active = false;
        if (typeof cancelIdleCallback === 'function') {
          cancelIdleCallback(idleCallbackId);
        }
      };
    }

    const timeoutId = setTimeout(preload, 250);
    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [startupReady]);

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
