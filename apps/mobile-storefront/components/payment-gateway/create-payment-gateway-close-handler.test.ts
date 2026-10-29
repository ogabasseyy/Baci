import { jest } from '@jest/globals';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { createPaymentGatewayCloseHandler } from './create-payment-gateway-close-handler';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn() },
}));

it('routes a pending Redvault attempt to its order after the customer leaves', () => {
  let leave: (() => void) | undefined;
  const spy = jest
    .spyOn(Alert, 'alert')
    .mockImplementation((_title, _message, buttons) => {
      leave = buttons?.find((button) => button.text === 'Leave')?.onPress;
    });
  const close = createPaymentGatewayCloseHandler({
    customerId: 'customer-1',
    userId: 'user-1',
    orderId: 'order-1',
    paymentKind: 'order',
    paymentMethod: 'uba_redvault',
  });
  close();
  leave?.();
  expect(router.replace).toHaveBeenCalledWith('/orders/order-1');
  expect(router.back).not.toHaveBeenCalled();
  spy.mockRestore();
});
