import type { ReactNode } from 'react';
import type { ModalProps, StyleProp, ViewStyle } from 'react-native';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

export type ModalSheetProps = {
  animationType?: ModalProps['animationType'];
  backdropStyle?: StyleProp<ViewStyle>;
  cardStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
  onBackdropPress?: () => void;
  onRequestClose?: () => void;
  visible: boolean;
};

export function ModalSheet({
  animationType = 'slide',
  backdropStyle,
  cardStyle,
  children,
  onBackdropPress,
  onRequestClose,
  visible,
}: ModalSheetProps) {
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
      {backdrop}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  card: {},
});
