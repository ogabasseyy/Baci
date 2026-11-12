import { render, screen } from '@testing-library/react-native';
import { BackHandler, Modal, Platform, StyleSheet, Text } from 'react-native';
import { CheckoutSheetPresentation } from './CheckoutSheetPresentation';

it('uses the inline Android layer and handles hardware Back until unmount', () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const onClose = jest.fn();
  let handleBack:
    | Parameters<typeof BackHandler.addEventListener>[1]
    | undefined;
  const remove = jest.fn();
  const listener = jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation((_event, handler) => {
      handleBack = handler;
      return { remove };
    });
  const view = render(
    <CheckoutSheetPresentation busy={false} isActive onClose={onClose}>
      <Text>Checkout form</Text>
    </CheckoutSheetPresentation>
  );

  const overlay = screen.getByTestId('checkout-identity-inline-overlay');
  expect(StyleSheet.flatten(overlay.props.style).elevation).toBe(100);
  expect(StyleSheet.flatten(overlay.props.style).zIndex).toBe(100);
  expect(screen.getByText('Checkout form')).toBeTruthy();
  expect(view.UNSAFE_root.findAllByType(Modal)).toHaveLength(0);
  expect(handleBack?.({ type: 'hardwareBackPress', timeStamp: 0 })).toBe(true);
  expect(onClose).toHaveBeenCalledTimes(1);

  view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
  listener.mockRestore();
  jest.restoreAllMocks();
});

it('keeps the native Modal presentation on iOS without a BackHandler listener', () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const listener = jest.spyOn(BackHandler, 'addEventListener');
  const view = render(
    <CheckoutSheetPresentation busy={false} isActive onClose={jest.fn()}>
      <Text>Checkout form</Text>
    </CheckoutSheetPresentation>
  );

  expect(screen.queryByTestId('checkout-identity-inline-overlay')).toBeNull();
  expect(screen.getByText('Checkout form')).toBeTruthy();
  expect(view.UNSAFE_root.findAllByType(Modal)).toHaveLength(1);
  expect(view.UNSAFE_root.findByType(Modal).props.accessibilityLabel).toBe(
    'Checkout sign-in options'
  );
  expect(listener).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

it('does not close an unfocused sheet and consumes Back while auth is busy', () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const onClose = jest.fn();
  let handleBack:
    | Parameters<typeof BackHandler.addEventListener>[1]
    | undefined;
  jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation((_event, handler) => {
      handleBack = handler;
      return { remove: jest.fn() };
    });
  const view = render(
    <CheckoutSheetPresentation busy={false} isActive={false} onClose={onClose}>
      <Text>Checkout form</Text>
    </CheckoutSheetPresentation>
  );

  expect(handleBack?.({ type: 'hardwareBackPress', timeStamp: 0 })).toBe(false);
  expect(onClose).not.toHaveBeenCalled();

  view.rerender(
    <CheckoutSheetPresentation busy isActive onClose={onClose}>
      <Text>Checkout form</Text>
    </CheckoutSheetPresentation>
  );
  expect(handleBack?.({ type: 'hardwareBackPress', timeStamp: 0 })).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});
