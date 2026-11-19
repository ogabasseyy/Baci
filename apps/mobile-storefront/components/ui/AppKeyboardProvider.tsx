import type { ReactNode } from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';

interface AppKeyboardProviderProps {
  children: ReactNode;
}

export default function AppKeyboardProvider({
  children,
}: AppKeyboardProviderProps) {
  // Controller 1.22.7 preloads by focusing a hidden iOS text field, which
  // can stall launch or flash over Spotlight. Let the first input open it.
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
