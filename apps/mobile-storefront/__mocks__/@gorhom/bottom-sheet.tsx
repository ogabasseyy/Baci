import type { ReactNode } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

export default function BottomSheet({
  children,
  ...props
}: {
  children?: ReactNode;
  [key: string]: unknown;
}) {
  return (
    <View testID="gorhom-sheet" {...props}>
      {children}
    </View>
  );
}

export function BottomSheetBackdrop() {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss sheet" />
  );
}

export const BottomSheetScrollView = ScrollView;
export const BottomSheetTextInput = TextInput;
