import { type ReactNode, useEffect, useRef } from 'react';
import type { ModalProps, StyleProp, ViewStyle } from 'react-native';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

// Start fully below the screen whatever the card's height.
const CARD_SLIDE_DISTANCE = Dimensions.get('window').height;
const CARD_SLIDE_MS = 280;

import { useKeyboard } from '@/hooks/use-keyboard';

export type ModalSheetProps = {
  animationType?: ModalProps['animationType'];
  /**
   * 'fade-backdrop': the dimmed backdrop fades in on the spot while only the
   * card slides up, instead of the whole backdrop sliding up with the card.
   */
  presentation?: 'native' | 'fade-backdrop';
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
  presentation = 'native',
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
  const fadeBackdrop = presentation === 'fade-backdrop';
  // Card slides up on its own while the Modal fades the backdrop in place.
  const cardOffset = useRef(new Animated.Value(CARD_SLIDE_DISTANCE)).current;
  useEffect(() => {
    if (!fadeBackdrop) return;
    if (!visible) {
      cardOffset.setValue(CARD_SLIDE_DISTANCE);
      return;
    }
    Animated.timing(cardOffset, {
      toValue: 0,
      duration: CARD_SLIDE_MS,
      useNativeDriver: true,
    }).start();
  }, [fadeBackdrop, visible, cardOffset]);
  const content = fadeBackdrop ? (
    <Animated.View
      style={[combinedCardStyle, { transform: [{ translateY: cardOffset }] }]}
    >
      {children}
    </Animated.View>
  ) : (
    <View style={combinedCardStyle}>{children}</View>
  );
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
      animationType={fadeBackdrop ? 'fade' : animationType}
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
