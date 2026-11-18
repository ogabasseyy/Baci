// useEffectEvent is stable React since 19.2; this app pins react 19.3.0.
import { type ReactNode, useEffect, useEffectEvent, useState } from 'react';
import type { ModalProps, StyleProp, ViewStyle } from 'react-native';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

const CARD_SLIDE_MS = 280;

import { useKeyboard } from '@/hooks/use-keyboard';

export type ModalSheetProps = {
  animationType?: ModalProps['animationType'];
  /**
   * 'fade-backdrop': the dimmed backdrop fades in on the spot while only the
   * card slides up, instead of the whole backdrop sliding up with the card.
   * It takes precedence over `animationType`, which it sets to 'fade'.
   */
  presentation?: 'native' | 'fade-backdrop';
  backdropStyle?: StyleProp<ViewStyle>;
  cardStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
  keyboardAutomaticOffset?: boolean;
  keyboardSurfaceColor?: string;
  onBackdropPress?: () => void;
  onRequestClose?: () => void;
  /** fade-backdrop only: called once the closing slide has finished. */
  onClosed?: () => void;
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
  onClosed,
  visible,
}: ModalSheetProps) {
  const { keyboardHeight } = useKeyboard();
  const handleBackdropPress = () => {
    onBackdropPress?.();
    // Callers often wire the same close handler to both: run it once.
    if (onRequestClose !== onBackdropPress) onRequestClose?.();
  };
  const combinedBackdropStyle = [styles.backdrop, backdropStyle];
  const combinedCardStyle = [styles.card, cardStyle];
  const fadeBackdrop = presentation === 'fade-backdrop';
  // Card slides on its own while the Modal fades the backdrop in place. It
  // starts fully below the current window (tracks rotation) whatever the
  // card's height. On close the Modal stays mounted until the card has slid
  // back down, then fades out.
  const { height: slideDistance } = useWindowDimensions();
  const [cardOffset] = useState(() => new Animated.Value(slideDistance));
  const [mounted, setMounted] = useState(visible);
  // Mark as mounted during render when opening, so the effect below does not
  // re-run (and restart the opening slide) just to record it.
  if (visible && !mounted) setMounted(true);
  const notifyClosed = useEffectEvent(() => onClosed?.());
  const alreadyClosed = useEffectEvent(() => !mounted);
  useEffect(() => {
    if (!fadeBackdrop) return;
    // Already closed (first mount, or a rotation while closed): nothing to
    // animate and no close to report.
    if (!visible && alreadyClosed()) {
      cardOffset.setValue(slideDistance);
      return;
    }
    const slide = Animated.timing(cardOffset, {
      toValue: visible ? 0 : slideDistance,
      duration: CARD_SLIDE_MS,
      useNativeDriver: true,
    });
    slide.start(({ finished }) => {
      if (finished && !visible) {
        setMounted(false);
        notifyClosed();
      }
    });
    return () => slide.stop();
  }, [fadeBackdrop, visible, cardOffset, slideDistance]);
  const modalVisible = fadeBackdrop ? visible || mounted : visible;
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
      visible={modalVisible}
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
