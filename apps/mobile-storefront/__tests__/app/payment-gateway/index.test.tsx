import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import PaymentGatewayScreen from '@/app/payment-gateway';

const mockRetry = jest.fn();
let mockStatus = 'pending';
let mockReturnTo: string | undefined;
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({ id: '11111111-1111-4111-8111-111111111111' }),
}));
jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: require('react-native').View,
}));
jest.mock(
  '@/components/payment-gateway/use-payment-gateway-controller',
  () => ({
    usePaymentGatewayController: () => ({
      // Stamped owner launch: the legacy ownership check is skipped.
      validatedParams: {
        isValid: true,
        data: { userId: '11111111-1111-4111-8111-111111111111' },
      },
      paymentKind: 'primary_wallet_card',
      status: mockStatus,
      errorMessage: null,
      handleRetry: mockRetry,
      returnTo: mockReturnTo,
    }),
  })
);
jest.mock('@/components/payment-gateway/PaymentGatewayCheckoutView', () => ({
  PaymentGatewayCheckoutView: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockReturnTo = undefined;
});

it.each([
  ['pending', 'Wallet funding pending'],
  ['error', 'Could not check funding status'],
  // A never-emitted 'held' stays on primary funding copy instead of
  // leaking into the generic Redvault held view.
  ['held', 'Wallet funding pending'],
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

it('fails closed to primary funding copy on an unknown future status', () => {
  mockStatus = 'future-terminal-state';
  render(<PaymentGatewayScreen />);
  expect(screen.getByRole('header').props.children).toBe(
    'Wallet funding pending'
  );
  expect(screen.queryByText('View your orders')).toBeNull();
  expect(screen.queryByText('Payment Failed')).toBeNull();
});

it('resumes the saved savings handoff when leaving the pending funding view', () => {
  mockStatus = 'pending';
  mockReturnTo = '/wallet?action=savings&savingsGoalId=owned-goal';
  render(<PaymentGatewayScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Return to wallet' }));
  expect(router.replace).toHaveBeenCalledWith(mockReturnTo);
});
