import type { ReactNode } from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';

/**
 * Starts keyboard tracking for the whole app: it reads the real keyboard frame
 * on every animation frame, so views that follow it move together with it.
 */
export function AppKeyboardProvider({ children }: { children: ReactNode }) {
  // Controller 1.22.7 preloads by focusing a hidden iOS text field, which can
  // stall launch or flash over Spotlight. Let the first input open it.
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
