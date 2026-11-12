import { render, screen } from '@testing-library/react-native';
import { BackHandler, Modal, Platform, Text } from 'react-native';
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
    <CheckoutSheetPresentation onClose={onClose}>
      <Text>Checkout form</Text>
    </CheckoutSheetPresentation>
  );

  expect(screen.getByTestId('checkout-identity-inline-overlay')).toBeTruthy();
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
    <CheckoutSheetPresentation onClose={jest.fn()}>
      <Text>Checkout form</Text>
    </CheckoutSheetPresentation>
  );

  expect(screen.queryByTestId('checkout-identity-inline-overlay')).toBeNull();
  expect(screen.getByText('Checkout form')).toBeTruthy();
  expect(view.UNSAFE_root.findAllByType(Modal)).toHaveLength(1);
  expect(listener).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});
