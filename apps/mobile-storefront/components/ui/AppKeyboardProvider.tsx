import type { ReactNode } from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';

interface AppKeyboardProviderProps {
  children: ReactNode;
}

export default function AppKeyboardProvider({
  children,
}: AppKeyboardProviderProps) {
  // Avoid launch-time UIKit work and the hidden responder's Spotlight flash
  // on the pinned controller version. The first input opens the keyboard.
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
