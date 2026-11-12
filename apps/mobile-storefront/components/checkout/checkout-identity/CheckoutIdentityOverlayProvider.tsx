import { type ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CheckoutIdentityModal } from './CheckoutIdentityModal';
import { CheckoutIdentityOverlayContext } from './CheckoutIdentityOverlayContext';

/** Host the Android inline checkout sheet above navigation and app chrome. */
export function CheckoutIdentityOverlayProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [onVerified, setOnVerified] = useState<(() => void) | undefined>();

  const open = (onVerified?: () => void) => {
    setOnVerified(() => onVerified);
    setIsOpen(true);
  };
  const close = () => {
    setOnVerified(undefined);
    setIsOpen(false);
  };

  return (
    <CheckoutIdentityOverlayContext.Provider value={{ isOpen, open, close }}>
      <View style={styles.root}>
        <View
          style={[styles.content, { pointerEvents: isOpen ? 'none' : 'auto' }]}
          importantForAccessibility={isOpen ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={isOpen}
        >
          {children}
        </View>
        <CheckoutIdentityModal
          isOpen={isOpen}
          onClose={close}
          onVerified={onVerified}
        />
      </View>
    </CheckoutIdentityOverlayContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
});
