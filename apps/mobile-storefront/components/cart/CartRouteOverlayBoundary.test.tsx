import { fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, StyleSheet, Text } from 'react-native';
import { CartRouteOverlayBoundary } from './CartRouteOverlayBoundary';

it('blocks and hides every route sibling when an inline overlay is open', () => {
  const onStatusAction = jest.fn();
  const content = (
    <>
      <Pressable accessibilityRole="button" onPress={onStatusAction}>
        <Text>Shared cart status action</Text>
      </Pressable>
      <Pressable accessibilityRole="button">
        <Text>Cart checkout action</Text>
      </Pressable>
    </>
  );
  const overlay = (
    <Text accessibilityRole="header">Checkout sign in options</Text>
  );
  const { rerender, UNSAFE_root } = render(
    <CartRouteOverlayBoundary overlay={overlay} overlayVisible={false}>
      {content}
    </CartRouteOverlayBoundary>
  );

  fireEvent.press(
    screen.getByRole('button', { name: 'Shared cart status action' })
  );
  expect(onStatusAction).toHaveBeenCalledTimes(1);

  rerender(
    <CartRouteOverlayBoundary overlay={overlay} overlayVisible>
      {content}
    </CartRouteOverlayBoundary>
  );

  const contentLayer = UNSAFE_root.findByProps({
    importantForAccessibility: 'no-hide-descendants',
  });
  expect(StyleSheet.flatten(contentLayer.props.style).pointerEvents).toBe(
    'none'
  );
  expect(
    screen.queryByRole('button', { name: 'Shared cart status action' })
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Cart checkout action' })
  ).toBeNull();
  expect(
    screen.getByRole('header', { name: 'Checkout sign in options' })
  ).toBeTruthy();
});
