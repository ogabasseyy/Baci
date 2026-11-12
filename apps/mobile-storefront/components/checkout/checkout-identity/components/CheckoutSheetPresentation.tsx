import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { BackHandler, Modal, Platform, StyleSheet, View } from 'react-native';

export function CheckoutSheetPresentation({
  children,
  busy,
  isActive,
  onClose,
}: {
  children: ReactNode;
  busy: boolean;
  isActive: boolean;
  onClose: () => void;
}) {
  const inline = Platform.OS === 'android';
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  const isActiveRef = useRef(isActive);

  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
    isActiveRef.current = isActive;
  }, [busy, isActive, onClose]);

  useEffect(() => {
    if (!inline) return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (!isActiveRef.current) return false;
        if (busyRef.current) return true;
        onCloseRef.current();
        return true;
      }
    );
    return () => subscription.remove();
  }, [inline]);

  if (inline) {
    // Keep this layer in the React tree on Android; native Modal presentation
    // caused checkout transitions to stall on lower-end devices.
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
    zIndex: 100,
    elevation: 100,
  },
});
