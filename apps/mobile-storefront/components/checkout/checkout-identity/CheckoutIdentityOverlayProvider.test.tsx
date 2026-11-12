import { fireEvent, render, screen } from '@testing-library/react-native';
import mockReact, { useEffect } from 'react';
import {
  Pressable as mockPressable,
  Text as mockText,
  View as mockView,
  Pressable,
  StyleSheet,
  Text,
} from 'react-native';
import { CheckoutIdentityOverlayProvider } from './CheckoutIdentityOverlayProvider';
import { useCheckoutIdentityOverlay } from './useCheckoutIdentityOverlay';

jest.mock('@/components/cart/CartWriteNotice', () => ({
  CartWriteNotice: () =>
    mockReact.createElement(
      mockText,
      { testID: 'cart-write-notice' },
      'Cart write notice'
    ),
}));

jest.mock('./CheckoutIdentityModal', () => ({
  CheckoutIdentityModal: ({
    isOpen,
    onClose,
    onVerified,
    onGuestCheckout,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onVerified?: () => void;
    onGuestCheckout?: () => void;
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
          ),
          mockReact.createElement(
            mockPressable,
            {
              accessibilityRole: 'button',
              onPress: () => {
                onClose();
                onGuestCheckout?.();
              },
            },
            mockReact.createElement(mockText, null, 'Continue as Guest')
          )
        )
      : null,
}));

function CartCheckoutControl({
  onVerified,
  onGuestCheckout,
  label = 'Open checkout identity',
  testID,
}: {
  onVerified: () => void;
  onGuestCheckout?: () => void;
  label?: string;
  testID?: string;
}) {
  const { open } = useCheckoutIdentityOverlay();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => open(onVerified, onGuestCheckout)}
      testID={testID}
    >
      <Text>{label}</Text>
    </Pressable>
  );
}

function ReplaceCallbackWhenOpen({ onVerified }: { onVerified: () => void }) {
  const { isOpen, open } = useCheckoutIdentityOverlay();
  useEffect(() => {
    if (isOpen) open(onVerified);
  }, [isOpen, onVerified, open]);
  return null;
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
  expect(screen.getByTestId('cart-write-notice')).toBeOnTheScreen();
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

it('restores background interaction after closing without verification', () => {
  const onVerified = jest.fn();
  render(
    <CheckoutIdentityOverlayProvider>
      <Pressable accessibilityRole="button">
        <Text>Chat widget</Text>
      </Pressable>
      <CartCheckoutControl onVerified={onVerified} />
    </CheckoutIdentityOverlayProvider>
  );

  fireEvent.press(
    screen.getByRole('button', { name: 'Open checkout identity' })
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Close checkout identity' })
  );

  expect(onVerified).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Chat widget' })).toBeTruthy();
  expect(screen.queryByTestId('checkout-identity-overlay')).toBeNull();
});

it('throws when the overlay hook is used outside its provider', () => {
  expect(() => render(<CartCheckoutControl onVerified={jest.fn()} />)).toThrow(
    'useCheckoutIdentityOverlay must be used inside CheckoutIdentityOverlayProvider.'
  );
});

it('uses the latest completion callback when reopened while already open', () => {
  const firstCallback = jest.fn();
  const latestCallback = jest.fn();
  render(
    <CheckoutIdentityOverlayProvider>
      <CartCheckoutControl onVerified={firstCallback} />
      <ReplaceCallbackWhenOpen onVerified={latestCallback} />
    </CheckoutIdentityOverlayProvider>
  );

  fireEvent.press(
    screen.getByRole('button', { name: 'Open checkout identity' })
  );
  fireEvent.press(screen.getByRole('button', { name: 'Complete sign in' }));

  expect(firstCallback).not.toHaveBeenCalled();
  expect(latestCallback).toHaveBeenCalledTimes(1);
});

it('passes the guest continuation callback through the overlay host', () => {
  const onVerified = jest.fn();
  const onGuestCheckout = jest.fn();
  render(
    <CheckoutIdentityOverlayProvider>
      <CartCheckoutControl
        onVerified={onVerified}
        onGuestCheckout={onGuestCheckout}
      />
    </CheckoutIdentityOverlayProvider>
  );

  fireEvent.press(
    screen.getByRole('button', { name: 'Open checkout identity' })
  );
  fireEvent.press(screen.getByRole('button', { name: 'Continue as Guest' }));

  expect(onGuestCheckout).toHaveBeenCalledTimes(1);
  expect(onVerified).not.toHaveBeenCalled();
});
