import { createContext, type ReactNode, useContext } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

const MockBottomSheetContext = createContext(false);

export default function BottomSheet({
  children,
  ...props
}: {
  children?: ReactNode;
  [key: string]: unknown;
}) {
  return (
    <MockBottomSheetContext.Provider value>
      <View testID="gorhom-sheet" {...props}>
        {children}
      </View>
    </MockBottomSheetContext.Provider>
  );
}

export function BottomSheetBackdrop() {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss sheet" />
  );
}

export const BottomSheetScrollView = ScrollView;
export function BottomSheetTextInput(
  props: React.ComponentProps<typeof TextInput>
) {
  const insideBottomSheet = useContext(MockBottomSheetContext);
  if (!insideBottomSheet) {
    throw new Error('BottomSheetTextInput must be rendered inside BottomSheet');
  }
  return (
    <TextInput {...props} testID={props.testID ?? 'bottom-sheet-text-input'} />
  );
}
