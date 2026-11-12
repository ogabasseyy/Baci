import type { ReactNode } from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';

interface AppKeyboardProviderProps {
  children: ReactNode;
}

export default function AppKeyboardProvider({
  children,
}: AppKeyboardProviderProps) {
  // iOS warms the keyboard by focusing a hidden field on the main thread.
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
