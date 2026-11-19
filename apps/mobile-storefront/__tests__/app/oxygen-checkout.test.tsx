import { fireEvent, render, screen } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import OxygenCheckoutRoute from '@/app/oxygen-checkout';
import { OxygenCheckoutScreen } from '@/components/oxygen-checkout/OxygenCheckoutScreen';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));
jest.mock('@/components/oxygen-checkout/OxygenCheckoutScreen', () => ({
  OxygenCheckoutScreen: jest.fn(() => null),
}));

it.each([
  undefined,
  'invalid-order',
  ['123e4567-e89b-12d3-a456-426614174000'],
])('offers order history for an invalid checkout link %j', (orderId) => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ orderId });
  render(<OxygenCheckoutRoute />);

  expect(OxygenCheckoutScreen).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'View my orders' }));
  expect(router.replace).toHaveBeenCalledWith('/orders');
});
