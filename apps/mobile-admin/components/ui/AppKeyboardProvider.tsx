import type { ReactNode } from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';

/**
 * Starts keyboard tracking for the whole app: it reads the real keyboard frame
 * on every animation frame, so views that follow it move together with it.
 */
export function AppKeyboardProvider({ children }: { children: ReactNode }) {
  // Controller 1.22.7 preloads by focusing a hidden iOS text field, which can
  // stall launch or flash over Spotlight. Let the first input open it.
  // The translucent and edge-to-edge props state the layout the app already has
  // (edgeToEdgeEnabled=true): on Android the library then turns them on
  // whatever is passed, so they change no other screen.
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
