import type { ReactNode } from 'react';
import type { ModalProps, StyleProp, ViewStyle } from 'react-native';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useKeyboard } from '@/hooks/use-keyboard';

export type ModalSheetProps = {
  animationType?: ModalProps['animationType'];
  backdropStyle?: StyleProp<ViewStyle>;
  cardStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
  keyboardAutomaticOffset?: boolean;
  keyboardSurfaceColor?: string;
  onBackdropPress?: () => void;
  onRequestClose?: () => void;
  visible: boolean;
};

export function ModalSheet({
  animationType = 'slide',
  backdropStyle,
  cardStyle,
  children,
  keyboardAutomaticOffset = false,
  keyboardSurfaceColor,
  onBackdropPress,
  onRequestClose,
  visible,
}: ModalSheetProps) {
  const { keyboardHeight } = useKeyboard();
  const handleBackdropPress = () => {
    onBackdropPress?.();
    onRequestClose?.();
  };
  const combinedBackdropStyle = [styles.backdrop, backdropStyle];
  const combinedCardStyle = [styles.card, cardStyle];
  const content = <View style={combinedCardStyle}>{children}</View>;
  const backdrop = onBackdropPress ? (
    <View style={combinedBackdropStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss modal"
        onPress={handleBackdropPress}
        style={StyleSheet.absoluteFill}
      />
      {content}
    </View>
  ) : (
    <View style={combinedBackdropStyle}>{content}</View>
  );

  return (
    <Modal
      visible={visible}
      animationType={animationType}
      presentationStyle="overFullScreen"
      transparent
      accessibilityViewIsModal
      onRequestClose={onRequestClose}
    >
      {keyboardSurfaceColor && keyboardHeight > 0 ? (
        <View
          testID="modal-keyboard-surface"
          style={[
            styles.keyboardSurface,
            {
              backgroundColor: keyboardSurfaceColor,
              height: keyboardHeight,
              pointerEvents: 'none',
            },
          ]}
        />
      ) : null}
      <KeyboardAvoidingView
        automaticOffset={keyboardAutomaticOffset}
        behavior="padding"
        style={styles.avoider}
      >
        {backdrop}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardSurface: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  avoider: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  card: {},
});
