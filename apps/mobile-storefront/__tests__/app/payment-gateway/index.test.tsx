import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import PaymentGatewayScreen from '@/app/payment-gateway';

const mockRetry = jest.fn();
let mockStatus = 'pending';
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/stores/auth-store', () => ({ useAuthStore: () => null }));
jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: require('react-native').View,
}));
jest.mock(
  '@/components/payment-gateway/use-payment-gateway-controller',
  () => ({
    usePaymentGatewayController: () => ({
      validatedParams: { isValid: true },
      paymentKind: 'primary_wallet_card',
      status: mockStatus,
      errorMessage: null,
      handleRetry: mockRetry,
    }),
  })
);
jest.mock('@/components/payment-gateway/PaymentGatewayCheckoutView', () => ({
  PaymentGatewayCheckoutView: () => null,
}));

beforeEach(() => jest.clearAllMocks());

it.each([
  ['pending', 'Wallet funding pending'],
  ['error', 'Could not check funding status'],
])('routes primary %s to safe funding status UI, not failed payment or orders', (status, title) => {
  mockStatus = status;
  render(<PaymentGatewayScreen />);
  expect(screen.getByRole('header').props.children).toBe(title);
  expect(screen.getByRole('alert').props.children).toContain(
    'Do not pay again'
  );
  expect(screen.queryByText('View your orders')).toBeNull();
  expect(screen.queryByText('Payment Failed')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Check funding status' }));
  expect(mockRetry).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('button', { name: 'Return to wallet' }));
  expect(router.replace).toHaveBeenCalledWith('/wallet');
});
