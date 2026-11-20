import type { PropsWithChildren } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

export function ModalSafeArea({
  children,
  style,
}: PropsWithChildren<{ style: StyleProp<ViewStyle> }>) {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={style}>{children}</SafeAreaView>
    </SafeAreaProvider>
  );
}
