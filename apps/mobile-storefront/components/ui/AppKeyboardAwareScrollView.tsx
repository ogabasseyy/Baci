import type { ReactNode, Ref } from 'react';
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewProps,
  type KeyboardAwareScrollViewRef,
} from 'react-native-keyboard-controller';

const DEFAULT_KEYBOARD_BOTTOM_OFFSET = 24;
const DEFAULT_KEYBOARD_TAPS = 'handled';
const DEFAULT_INSET_ADJUSTMENT = 'automatic';

type AppKeyboardAwareScrollViewProps = KeyboardAwareScrollViewProps & {
  children?: ReactNode;
  ref?: Ref<KeyboardAwareScrollViewRef>;
};

export default function AppKeyboardAwareScrollView({
  bottomOffset = DEFAULT_KEYBOARD_BOTTOM_OFFSET,
  children,
  contentInsetAdjustmentBehavior = DEFAULT_INSET_ADJUSTMENT,
  keyboardShouldPersistTaps = DEFAULT_KEYBOARD_TAPS,
  ...props
}: AppKeyboardAwareScrollViewProps) {
  return (
    <KeyboardAwareScrollView
      bottomOffset={bottomOffset}
      contentInsetAdjustmentBehavior={contentInsetAdjustmentBehavior}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      {...props}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
