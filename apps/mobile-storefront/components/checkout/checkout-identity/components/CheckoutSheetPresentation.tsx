import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { BackHandler, Modal, Platform, StyleSheet, View } from 'react-native';

export function CheckoutSheetPresentation({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const inline = Platform.OS === 'android';
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!inline) return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onCloseRef.current();
        return true;
      }
    );
    return () => subscription.remove();
  }, [inline]);

  if (inline) {
    return (
      <View
        style={styles.overlay}
        accessibilityViewIsModal
        accessibilityLabel="Checkout sign-in options"
        importantForAccessibility="yes"
        testID="checkout-identity-inline-overlay"
      >
        {children}
      </View>
    );
  }

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      accessibilityViewIsModal
      accessibilityLabel="Checkout sign-in options"
    >
      {children}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
    elevation: 1,
  },
});
