import type { ReactNode } from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useDeferredKeyboardPreload } from './useDeferredKeyboardPreload';

interface AppKeyboardProviderProps {
  children: ReactNode;
  startupReady?: boolean;
}

export default function AppKeyboardProvider({
  children,
  startupReady = false,
}: AppKeyboardProviderProps) {
  useDeferredKeyboardPreload(startupReady);

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
