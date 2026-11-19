import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { PAYMENT_LOAD_TIMEOUT_MESSAGE } from './payment-gateway-controller.helpers';
import type { PaymentGatewayStatus } from './payment-gateway-controller.types';
import { useWalletPaystackCheckout } from './use-wallet-paystack-checkout';

const readyMessage = JSON.stringify({ type: 'baci_payment_page_interactive' });

it('only treats readiness as a display signal for the Paystack wallet flow', () => {
  const statusRef = { current: 'loading' as PaymentGatewayStatus };
  const setPaymentStatus = jest.fn();
  const setErrorMessage = jest.fn();
  const { result, rerender } = renderHook(
    ({ enabled }: { enabled: boolean }) =>
      useWalletPaystackCheckout({
        enabled,
        statusRef,
        setErrorMessage,
        setPaymentStatus,
      }),
    { initialProps: { enabled: false } }
  );
  act(() => {
    expect(result.current.handleMessage(readyMessage)).toBe(false);
  });
  expect(result.current.interactive).toBe(false);
  rerender({ enabled: true });
  act(() => {
    expect(result.current.handleMessage(readyMessage)).toBe(true);
  });
  expect(result.current.interactive).toBe(true);
  expect(setPaymentStatus).not.toHaveBeenCalled();
  act(() => {
    expect(result.current.onLoadTimeout()).toBe(true);
  });
  expect(result.current.stalled).toBe(true);
  statusRef.current = 'ready';
  act(() => result.current.onLoadEnd());
  expect(result.current.stalled).toBe(false);
});

it('resets the visible recovery prompt for a new checkout navigation', () => {
  const statusRef = { current: 'loading' as PaymentGatewayStatus };
  const { result } = renderHook(() =>
    useWalletPaystackCheckout({
      enabled: true,
      statusRef,
      setErrorMessage: jest.fn(),
      setPaymentStatus: jest.fn(),
    })
  );
  act(() => {
    expect(result.current.handleMessage('not json')).toBe(false);
    expect(result.current.handleMessage('{"type":"other"}')).toBe(false);
    expect(result.current.onLoadTimeout()).toBe(false);
    result.current.handleMessage(readyMessage);
    result.current.onLoadTimeout();
  });
  expect(result.current.interactive).toBe(true);
  expect(result.current.stalled).toBe(true);
  act(() => result.current.onLoadStart());
  expect(result.current.interactive).toBe(false);
  expect(result.current.stalled).toBe(false);
});

it('does not interrupt a payment that is already being confirmed', () => {
  const statusRef = { current: 'processing' as PaymentGatewayStatus };
  const setPaymentStatus = jest.fn();
  const setErrorMessage = jest.fn();
  const clearTimeout = jest.fn();
  const { result } = renderHook(() =>
    useWalletPaystackCheckout({
      enabled: true,
      statusRef,
      setErrorMessage,
      setPaymentStatus,
    })
  );
  act(() => {
    expect(result.current.handleMessage(readyMessage)).toBe(false);
    result.current.showRecovery(clearTimeout);
  });
  expect(clearTimeout).not.toHaveBeenCalled();
  expect(setPaymentStatus).not.toHaveBeenCalled();
  expect(setErrorMessage).not.toHaveBeenCalled();
  statusRef.current = 'loading';
  act(() => result.current.showRecovery(clearTimeout));
  expect(clearTimeout).toHaveBeenCalledTimes(1);
  expect(setPaymentStatus).toHaveBeenCalledWith('error');
  expect(setErrorMessage).toHaveBeenCalledWith(PAYMENT_LOAD_TIMEOUT_MESSAGE);
});
