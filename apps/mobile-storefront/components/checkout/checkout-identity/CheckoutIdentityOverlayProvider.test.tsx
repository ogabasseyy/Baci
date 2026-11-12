import { fireEvent, render, screen } from '@testing-library/react-native';
import mockReact from 'react';
import {
  Pressable as mockPressable,
  Text as mockText,
  View as mockView,
  Pressable,
  StyleSheet,
  Text,
} from 'react-native';
import {
  CheckoutIdentityOverlayProvider,
  useCheckoutIdentityOverlay,
} from './CheckoutIdentityOverlayProvider';

jest.mock('./CheckoutIdentityModal', () => ({
  CheckoutIdentityModal: ({
    isOpen,
    onClose,
    onVerified,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onVerified?: () => void;
  }) =>
    isOpen
      ? mockReact.createElement(
          mockView,
          { testID: 'checkout-identity-overlay' },
          mockReact.createElement(
            mockText,
            { accessibilityRole: 'header' },
            'Checkout identity'
          ),
          mockReact.createElement(
            mockPressable,
            {
              accessibilityRole: 'button',
              onPress: () => {
                onClose();
                onVerified?.();
              },
            },
            mockReact.createElement(mockText, null, 'Complete sign in')
          ),
          mockReact.createElement(
            mockPressable,
            { accessibilityRole: 'button', onPress: onClose },
            mockReact.createElement(mockText, null, 'Close checkout identity')
          )
        )
      : null,
}));

function CartCheckoutControl({ onVerified }: { onVerified: () => void }) {
  const { open } = useCheckoutIdentityOverlay();
  return (
    <Pressable accessibilityRole="button" onPress={() => open(onVerified)}>
      <Text>Open checkout identity</Text>
    </Pressable>
  );
}

it('covers root app chrome and restores it after identity completion', () => {
  const onVerified = jest.fn();
  const { UNSAFE_root } = render(
    <CheckoutIdentityOverlayProvider>
      <Pressable accessibilityRole="button">
        <Text>Cart checkout footer</Text>
      </Pressable>
      <Pressable accessibilityRole="button">
        <Text>Chat widget</Text>
      </Pressable>
      <Pressable accessibilityRole="button">
        <Text>Drawer menu</Text>
      </Pressable>
      <CartCheckoutControl onVerified={onVerified} />
    </CheckoutIdentityOverlayProvider>
  );

  fireEvent.press(
    screen.getByRole('button', { name: 'Open checkout identity' })
  );

  const contentLayer = UNSAFE_root.findByProps({
    importantForAccessibility: 'no-hide-descendants',
  });
  expect(StyleSheet.flatten(contentLayer.props.style).pointerEvents).toBe(
    'none'
  );
  expect(screen.queryByRole('button', { name: 'Chat widget' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Drawer menu' })).toBeNull();
  expect(
    screen.getByRole('header', { name: 'Checkout identity' })
  ).toBeTruthy();

  fireEvent.press(screen.getByRole('button', { name: 'Complete sign in' }));

  expect(onVerified).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Chat widget' })).toBeTruthy();
  expect(screen.queryByTestId('checkout-identity-overlay')).toBeNull();
});
