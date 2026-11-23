import { useHeaderHeight } from 'expo-router/react-navigation';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

/**
 * Keeps its content above the keyboard, moving together with it, on a screen
 * that sits under a navigation header. The header height (status bar included)
 * is the offset between the top of the screen and this view, which is what the
 * keyboard-avoiding view needs to know to lift by the right amount.
 *
 * Only for screens inside a navigator that has a header: the header height is
 * not available anywhere else.
 */
export function HeaderKeyboardAvoidingView({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const headerHeight = useHeaderHeight();
  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
      style={style}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
